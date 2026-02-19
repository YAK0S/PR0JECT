import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Keyboard,
  ScrollView,
  FlatList,
  Alert,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

// Dependências (precisam estar no Snack -> Dependencies/package.json)
import * as XLSX from "xlsx";
import Svg, { Rect } from "react-native-svg"; // gráfico consolidação [2](https://www.npmjs.com/package/xlsx)

/* =========================================================
   1) CONSTANTES
========================================================= */
const SECTORS = ["PREDIAL", "RECEBIMENTO", "TORRE"];
const AREAS = ["MECÂNICA", "ELÉTRICA"];
const DATE_FILTERS = ["TODAY", "LAST_7_DAYS", "ALL"]; // consolidação

// Mapa de cores do Nível 1 (Valor)
const VALUE_COLOR_MAP = {
  "Agrega valor": "#22C55E",     // verde
  "Inerente": "#FACC15",        // amarelo
  "Não agrega valor": "#EF4444" // vermelho
};

/* =========================================================
   2) CLASSIFICAÇÃO (3 leituras)
   Valor -> Natureza -> Categoria -> Subcategoria/Detalhe
========================================================= */
const CLASSIFICATION = {
  Inerente: {
    "Relacionado à atividade": {
      "Reuniões diárias (DDS - DMS)": ["DMS 1 - FM2C"],
      "Comunicação operacional": [
        "Diálogo/solicitação com o supervisor sobre atividade",
      ],
      Deslocamento: [
        "Externo planejado (buscar insumos no almoxarifado)",
        "Interno planejado (pegar ferramenta , acesso à máquina de atuação)",
        "Interno planejado (pegar ferramenta, acesso a máquina de atuação)",
        "Interno planejado (pegar ferramenta, acesso à máquina de atuação)",
      ],
      "Organização & Preparação": [
        "Organização do equipamento/material utilizado",
        "Organização do equipamentos/material utilizado",
        "Organização do local da atividade",
      ],
      "Segurança & Procedimentos": [
        "Abertura da PT (Permissão de Trabalho)",
        "Abertura da PT (Permissão de trabalho)",
      ],
      "Buscando recursos": ["Deslocamento não planejado (peça não prevista)"],
    },
    "Não relacionado à atividade": {
      Deslocamento: [],
    },
  },

  "Agrega valor": {
    "Execução direta da atividade": {
      "": [],
    },
  },

  "Não agrega valor": {
    Pessoal: {
      "Ociosidade & Comunicação pessoal": [],
    },
    "Não relacionado à atividade": {
      "Pessoal inevitável": ["Alimentação", "Bebendo água", "Uso do banheiro"],
      "": [],
    },
    "Relacionado à atividade": {
      "Reuniões diárias (DDS - DMS)": [],
      "": [],
    },
    Recursos: {
      "Subutilização de recursos": [],
    },
  },
};

/* =========================================================
   3) HELPERS
========================================================= */
function keysOrEmpty(obj) {
  return obj && typeof obj === "object" ? Object.keys(obj) : [];
}

function safeFileName(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function toDateYMD(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toTimeHMS(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function msToHHMMSS(ms) {
  if (ms == null || ms < 0) return "";
  const totalSec = Math.floor(ms / 1000);
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function formatDurationMs(ms) {
  if (ms == null || ms < 0) return "—";
  return msToHHMMSS(ms);
}

function formatDate(iso) {
  const ymd = toDateYMD(iso);
  return ymd || "—";
}

function formatTime(iso) {
  const hms = toTimeHMS(iso);
  return hms || "—";
}

function formatPath({ v, n, c, s }) {
  return [v, n, c, s].filter(Boolean).join(" > ") || "—";
}

function addToMap(map, key, ms) {
  const k = key && String(key).trim() ? key : "(Não informado)";
  map[k] = (map[k] || 0) + ms;
}

function sortTotalsDesc(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]);
}

function inDateFilter(dateFilter, iso) {
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  if (dateFilter === "ALL") return true;

  if (dateFilter === "TODAY") {
    return d.getTime() >= startOfToday;
  }

  if (dateFilter === "LAST_7_DAYS") {
    const sevenDaysAgo = startOfToday - 6 * 24 * 60 * 60 * 1000;
    return d.getTime() >= sevenDaysAgo;
  }

  return true;
}

function calcSessionTotalMs(activities) {
  let total = 0;
  (activities || []).forEach((a) => {
    const startMs = a.startAt ? new Date(a.startAt).getTime() : null;
    const endMs = a.endAt ? new Date(a.endAt).getTime() : null;
    if (startMs == null || endMs == null) return;
    total += Math.max(0, endMs - startMs);
  });
  return total;
}

/* =========================================================
   4) COMPONENTES REUTILIZÁVEIS
========================================================= */
function Button({ title, onPress, variant = "primary", disabled = false }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        variant === "primary" ? styles.btnPrimary : styles.btnGhost,
        disabled && { opacity: 0.4 },
        pressed && !disabled && { opacity: 0.75 },
      ]}
    >
      <Text style={styles.btnText}>{title}</Text>
    </Pressable>
  );
}

/**
 * Selector (segmented)
 * ✅ Novo: selectedColorMap (para colorir seleção por opção)
 */
function Selector({
  label,
  options,
  value,
  onChange,
  disabled = false,
  selectedColorMap = null, // { option: "#hex" }
}) {
  return (
    <View style={{ marginTop: 12, opacity: disabled ? 0.55 : 1 }}>
      <Text style={styles.label}>{label}</Text>

      {options.length === 0 ? (
        <Text style={styles.helper}>Sem opções.</Text>
      ) : (
        <View style={styles.segmentContainer}>
          {options.map((opt) => {
            const selected = opt === value;

            // Cor do selecionado (se existir mapa)
            const selectedColor = selectedColorMap?.[opt] || "#2563EB";

            // Texto no amarelo fica melhor preto
            const textColor =
              selected && selectedColor === VALUE_COLOR_MAP["Inerente"]
                ? "#0B1220"
                : "white";

            return (
              <Pressable
                key={opt}
                onPress={disabled ? undefined : () => onChange(opt)}
                style={[
                  styles.segment,
                  selected ? { backgroundColor: selectedColor, borderColor: selectedColor } : styles.segmentUnselected,
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    selected && { color: textColor },
                  ]}
                >
                  {opt || "(Sem opção)"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

/**
 * Barra empilhada (%)
 * Usa react-native-svg (Expo suporta) [2](https://www.npmjs.com/package/xlsx)
 */
function StackedPercentBar({ width = 320, height = 16, parts }) {
  const total = parts.reduce((acc, p) => acc + (p.valuePct || 0), 0) || 1;
  let x = 0;

  return (
    <Svg width={width} height={height}>
      {parts.map((p, idx) => {
        const w = (width * (p.valuePct || 0)) / total;
        const rect = (
          <Rect
            key={idx}
            x={x}
            y={0}
            width={w}
            height={height}
            fill={p.color}
            rx={6}
            ry={6}
          />
        );
        x += w;
        return rect;
      })}
    </Svg>
  );
}

/* =========================================================
   5) EXPORT XLSX
========================================================= */
function downloadXLSX(filename, workbook) {
  try {
    const xlsxData = XLSX.write(workbook, { bookType: "xlsx", type: "array" });

    if (typeof document !== "undefined") {
      const blob = new Blob([xlsxData], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return true;
    }

    Alert.alert(
      "Exportação no dispositivo",
      "No Snack/Expo Go, salvar .xlsx pode ser limitado. Use o Preview Web para baixar."
    );
    return false;
  } catch (e) {
    Alert.alert("Erro ao gerar XLSX", String(e?.message || e));
    return false;
  }
}

function buildWorkbookSessionXLSX({ session, activities, summary }) {
  const rowsActivities = (activities || []).map((a) => {
    const startMs = a.startAt ? new Date(a.startAt).getTime() : null;
    const endMs = a.endAt ? new Date(a.endAt).getTime() : null;
    const durMs = startMs != null && endMs != null ? Math.max(0, endMs - startMs) : null;

    const durSec = durMs != null ? Math.floor(durMs / 1000) : "";
    const durMin = durMs != null ? Math.round((durMs / 60000) * 100) / 100 : "";

    return {
      Acompanhador: session.observerName,
      Colaborador: session.workerName,
      Ordem: session.workOrder,
      Setor: session.sector,
      Area: session.area,

      Atividade: a.text,
      Valor: a.classification?.v || "",
      Natureza: a.classification?.n || "",
      Categoria: a.classification?.c || "",
      Subcategoria: a.classification?.s || "",

      DataInicio: toDateYMD(a.startAt),
      HoraInicio: toTimeHMS(a.startAt),
      DataFim: toDateYMD(a.endAt),
      HoraFim: toTimeHMS(a.endAt),

      DuracaoHHMMSS: durMs != null ? msToHHMMSS(durMs) : "",
      DuracaoMin: durMin,
      DuracaoSeg: durSec,

      InicioISO: a.startAt || "",
      FimISO: a.endAt || "",
    };
  });

  const totalsToRows = (obj) =>
    Object.entries(obj || {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, ms]) => ({
        Chave: k,
        TempoHHMMSS: msToHHMMSS(ms),
        TempoMin: Math.round((ms / 60000) * 100) / 100,
      }));

  const rowsSummary = [
    { Indicador: "Total medido (HH:MM:SS)", Valor: summary.totalFormatted },
    { Indicador: "Qtd. atividades", Valor: summary.countActivities },
    { Indicador: "Início (ISO)", Valor: session.sessionStartedAt },
    { Indicador: "Fim (ISO)", Valor: summary.endedAtISO || "" },
    {},
    { Indicador: "Tempo por Valor", Valor: "" },
    ...totalsToRows(summary.byValor),
    {},
    { Indicador: "Tempo por Natureza", Valor: "" },
    ...totalsToRows(summary.byNatureza),
    {},
    { Indicador: "Tempo por Categoria", Valor: "" },
    ...totalsToRows(summary.byCategoria),
  ];

  const wb = XLSX.utils.book_new();
  const wsA = XLSX.utils.json_to_sheet(rowsActivities);
  XLSX.utils.book_append_sheet(wb, wsA, "Atividades");
  const wsR = XLSX.utils.json_to_sheet(rowsSummary);
  XLSX.utils.book_append_sheet(wb, wsR, "Resumo");
  return wb;
}

function buildWorkbookConsolidatedXLSX({ perSession, consolidatedSummary }) {
  const rowsSessions = (perSession || []).map((s) => ({
    Data: toDateYMD(s.session.sessionStartedAt),
    HoraInicio: toTimeHMS(s.session.sessionStartedAt),
    HoraFim: toTimeHMS(s.endedAt),
    Acompanhador: s.session.observerName,
    Colaborador: s.session.workerName,
    Ordem: s.session.workOrder,
    Setor: s.session.sector,
    Area: s.session.area,
    TotalHHMMSS: msToHHMMSS(s.totalMs || 0),
    TotalMin: Math.round(((s.totalMs || 0) / 60000) * 100) / 100,
  }));

  const totalsToRows = (title, obj) => [
    { Tipo: title, Chave: "", TempoHHMMSS: "", TempoMin: "" },
    ...Object.entries(obj || {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, ms]) => ({
        Tipo: "",
        Chave: k,
        TempoHHMMSS: msToHHMMSS(ms),
        TempoMin: Math.round((ms / 60000) * 100) / 100,
      })),
    {},
  ];

  const rowsTotals = [
    { Tipo: "Resumo geral", Chave: "Total", TempoHHMMSS: consolidatedSummary.totalFormatted, TempoMin: Math.round((consolidatedSummary.totalMs / 60000) * 100) / 100 },
    { Tipo: "Resumo geral", Chave: "Qtd. coletas", TempoHHMMSS: String(consolidatedSummary.countSessions), TempoMin: "" },
    { Tipo: "Resumo geral", Chave: "Qtd. atividades", TempoHHMMSS: String(consolidatedSummary.countActivities), TempoMin: "" },
    {},
    ...totalsToRows("Tempo por Valor", consolidatedSummary.byValor),
    ...totalsToRows("Tempo por Natureza", consolidatedSummary.byNatureza),
    ...totalsToRows("Tempo por Categoria", consolidatedSummary.byCategoria),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsSessions), "Coletas");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsTotals), "Totais");
  return wb;
}

/* =========================================================
   6) TELAS
========================================================= */

// ✅ HOME: agora também tem acesso direto à consolidação
function HomeScreen({ onStartNew, onGoHistory, onGoConsolidation, totalSessions }) {
  return (
    <View style={{ flex: 1, justifyContent: "center" }}>
      <Text style={styles.homeTitle}>WRENCH TIME</Text>
      <Text style={styles.subtitleCenter}>
        Medições salvas nesta sessão: <Text style={styles.summaryStrong}>{totalSessions}</Text>
      </Text>

      <View style={{ marginTop: 18 }}>
        <Button title="Iniciar nova medição" onPress={onStartNew} />
        <Button title="Ver medições realizadas" onPress={onGoHistory} variant="ghost" />
        <Button title="Consolidação" onPress={onGoConsolidation} variant="ghost" />
      </View>

      <Text style={[styles.helper, { marginTop: 14, textAlign: "center" }]}>
        Dica: no Snack, as medições ficam em memória enquanto o Snack estiver aberto.
      </Text>
    </View>
  );
}

function EntryScreen({ onSubmit, onBackHome }) {
  const [observerName, setObserverName] = useState("");
  const [workerName, setWorkerName] = useState("");
  const [workOrder, setWorkOrder] = useState("");
  const [sector, setSector] = useState(SECTORS[0]);
  const [area, setArea] = useState(AREAS[0]);

  const canContinue = useMemo(() => {
    return observerName.trim() && workerName.trim() && workOrder.trim() && sector && area;
  }, [observerName, workerName, workOrder, sector, area]);

  function handleSubmit() {
    Keyboard.dismiss();
    onSubmit({
      observerName: observerName.trim(),
      workerName: workerName.trim(),
      workOrder: workOrder.trim(),
      sector,
      area,
      sessionStartedAt: new Date().toISOString(),
    });
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.h1}>Entrada</Text>
      <Text style={styles.subtitle}>Dados da medição</Text>

      <Text style={styles.label}>Nome do acompanhador</Text>
      <TextInput
        value={observerName}
        onChangeText={setObserverName}
        placeholder="Ex.: Klezio Fernandes"
        placeholderTextColor="#64748B"
        style={styles.input}
      />

      <Text style={styles.label}>Nome do colaborador</Text>
      <TextInput
        value={workerName}
        onChangeText={setWorkerName}
        placeholder="Ex.: Nome do técnico"
        placeholderTextColor="#64748B"
        style={styles.input}
      />

      <Text style={styles.label}>Número da Ordem de Serviço</Text>
      <TextInput
        value={workOrder}
        onChangeText={setWorkOrder}
        placeholder="Ex.: 4500123456"
        placeholderTextColor="#64748B"
        style={styles.input}
        onSubmitEditing={() => Keyboard.dismiss()}
      />

      <Selector label="Setor" options={SECTORS} value={sector} onChange={setSector} />
      <Selector label="Área de atuação" options={AREAS} value={area} onChange={setArea} />

      <View style={{ marginTop: 16 }}>
        <Button title="Iniciar (ir para atividades)" onPress={handleSubmit} disabled={!canContinue} />
        <Button title="Voltar ao início" onPress={onBackHome} variant="ghost" />
        {!canContinue && <Text style={styles.helper}>Preencha todos os campos para continuar.</Text>}
      </View>
    </ScrollView>
  );
}

// Tela Atividades (FlatList com Header) [1](https://stackoverflow.com/questions/55230628/is-there-a-way-to-speedup-npm-ci-using-cache)
function ActivityScreen({ session, onFinish, onBack }) {
  const [activityText, setActivityText] = useState("");

  const [v, setV] = useState("");
  const [n, setN] = useState("");
  const [c, setC] = useState("");
  const [s, setS] = useState("");

  const [activities, setActivities] = useState([]);
  const hasRunning = activities.length > 0 && !activities[activities.length - 1].endAt;

  const valueOptions = useMemo(() => keysOrEmpty(CLASSIFICATION), []);
  const natureOptions = useMemo(() => keysOrEmpty(CLASSIFICATION[v]), [v]);

  const categoryOptions = useMemo(() => {
    const cats = keysOrEmpty(CLASSIFICATION[v]?.[n]);
    return cats.filter((x) => x);
  }, [v, n]);

  const subOptions = useMemo(() => {
    if (!c) return [];
    const arr = CLASSIFICATION[v]?.[n]?.[c];
    return Array.isArray(arr) ? arr : [];
  }, [v, n, c]);

  function changeV(next) {
    setV(next);
    setN("");
    setC("");
    setS("");
  }
  function changeN(next) {
    setN(next);
    setC("");
    setS("");
  }
  function changeC(next) {
    setC(next);
    setS("");
  }

  const canInsertNext = useMemo(() => {
    if (!activityText.trim()) return false;
    if (!v || !n) return false;
    if (categoryOptions.length > 0 && !c) return false;
    if (c && subOptions.length > 0 && !s) return false;
    return true;
  }, [activityText, v, n, c, s, categoryOptions.length, subOptions.length]);

  function nextActivity() {
    if (!canInsertNext) return;
    const nowIso = new Date().toISOString();

    setActivities((prev) => {
      const closed = prev.map((a, idx) => {
        if (idx === prev.length - 1 && !a.endAt) return { ...a, endAt: nowIso };
        return a;
      });

      const newActivity = {
        id: String(Date.now()),
        text: activityText.trim(),
        classification: { v, n, c, s },
        startAt: nowIso,
        endAt: null,
      };

      return [...closed, newActivity];
    });

    setActivityText("");
    setV("");
    setN("");
    setC("");
    setS("");
    Keyboard.dismiss();
  }

  function finishSession() {
    const nowIso = new Date().toISOString();

    const finalized = (() => {
      if (activities.length === 0) return [];
      return activities.map((a, idx) => {
        if (idx === activities.length - 1 && !a.endAt) return { ...a, endAt: nowIso };
        return a;
      });
    })();

    onFinish({ endedAt: nowIso, activities: finalized });
    Keyboard.dismiss();
  }

  const headerLine = `${session.workerName} • OS ${session.workOrder} • ${session.sector} • ${session.area}`;

  return (
    <FlatList
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      data={activities}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <View>
          <Text style={styles.h1}>Atividades</Text>
          <Text style={styles.subtitle}>{headerLine}</Text>

          <Text style={styles.label}>Atividade executada</Text>
          <TextInput
            value={activityText}
            onChangeText={setActivityText}
            placeholder="Descreva a próxima atividade..."
            placeholderTextColor="#64748B"
            style={[styles.input, { minHeight: 60 }]}
            multiline
          />

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Classificação (cascata)</Text>

            {/* ✅ Aqui aplicamos o mapa de cores para Valor (Nível 1) */}
            <Selector
              label="Nível 1 — Valor"
              options={valueOptions}
              value={v}
              onChange={changeV}
              selectedColorMap={VALUE_COLOR_MAP}
            />

            <Selector
              label="Nível 2 — Natureza"
              options={natureOptions}
              value={n}
              onChange={changeN}
              disabled={!v}
            />

            <Selector
              label="Nível 3 — Categoria"
              options={categoryOptions}
              value={c}
              onChange={changeC}
              disabled={!n || categoryOptions.length === 0}
            />

            <Selector
              label="Nível 4 — Subcategoria / Detalhe"
              options={subOptions}
              value={s}
              onChange={setS}
              disabled={!c || subOptions.length === 0}
            />

            <Text style={styles.helper}>
              Use <Text style={{ color: "white", fontWeight: "900" }}>
                {hasRunning ? "Próxima atividade" : "Iniciar atividade"}
              </Text>{" "}
              para medir. Se já houver uma em andamento, ela será finalizada automaticamente.
            </Text>

            <Button
              title={hasRunning ? "Próxima atividade (fecha anterior)" : "Iniciar atividade"}
              onPress={nextActivity}
              disabled={!canInsertNext}
            />

            <Button
              title="Finalizar acompanhamento (ir para resumo)"
              onPress={finishSession}
              variant="ghost"
              disabled={activities.length === 0 && !hasRunning}
            />

            <Button title="Voltar" onPress={onBack} variant="ghost" />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Histórico de atividades</Text>
            {activities.length === 0 && <Text style={styles.helper}>Nenhuma atividade registrada ainda.</Text>}
          </View>
        </View>
      }
      renderItem={({ item, index }) => {
        const path = formatPath(item.classification);
        const durMs = (() => {
          const startMs = item.startAt ? new Date(item.startAt).getTime() : null;
          const endMs = item.endAt ? new Date(item.endAt).getTime() : null;
          return startMs != null && endMs != null ? endMs - startMs : null;
        })();

        return (
          <View style={styles.activityRow}>
            <Text style={styles.activityTitle}>{index + 1}. {item.text}</Text>
            <Text style={styles.activityMeta}>
              Classificação: <Text style={styles.activityMetaStrong}>{path}</Text>
            </Text>
            <Text style={styles.activityMeta}>
              Início: <Text style={styles.activityMetaStrong}>{formatTime(item.startAt)}</Text>{" "}
              • Fim: <Text style={styles.activityMetaStrong}>{formatTime(item.endAt)}</Text>{" "}
              • Duração: <Text style={styles.activityMetaStrong}>{formatDurationMs(durMs)}</Text>
            </Text>
          </View>
        );
      }}
    />
  );
}

// Histórico
function HistoryScreen({ sessions, onOpenSession, onGoConsolidation, onBackHome }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.h1}>Medições realizadas</Text>
      <Text style={styles.subtitle}>
        Total de medições salvas: <Text style={styles.summaryStrong}>{sessions.length}</Text>
      </Text>

      <View style={{ marginTop: 10 }}>
        <Button title="Consolidação" onPress={onGoConsolidation} disabled={sessions.length === 0} />
        <Button title="Voltar ao Início" onPress={onBackHome} variant="ghost" />
      </View>

      <View style={[styles.card, { flex: 1 }]}>
        {sessions.length === 0 ? (
          <Text style={styles.helper}>Ainda não há medições salvas.</Text>
        ) : (
          <FlatList
            data={[...sessions].reverse()}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const totalMs = calcSessionTotalMs(item.activities);
              return (
                <Pressable onPress={() => onOpenSession(item)} style={styles.sessionCard}>
                  <Text style={styles.sessionTitle}>
                    {item.session.workerName} • OS {item.session.workOrder}
                  </Text>
                  <Text style={styles.activityMeta}>
                    {item.session.sector} • {item.session.area} • {formatDate(item.session.sessionStartedAt)}
                  </Text>
                  <Text style={styles.activityMeta}>
                    Total: <Text style={styles.activityMetaStrong}>{msToHHMMSS(totalMs)}</Text>
                    {"  "}• Atividades: <Text style={styles.activityMetaStrong}>{item.activities.length}</Text>
                  </Text>
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </View>
  );
}

// Consolidação (menu próprio)
function ConsolidationScreen({ sessions, onBack, onExportConsolidatedXLSX }) {
  const [dateFilter, setDateFilter] = useState("LAST_7_DAYS");
  const [workerFilter, setWorkerFilter] = useState("TODOS");
  const [areaFilter, setAreaFilter] = useState("TODAS");
  const [sectorFilter, setSectorFilter] = useState("TODOS");

  const workerOptions = useMemo(() => {
    const names = Array.from(new Set(sessions.map((s) => s.session.workerName))).filter(Boolean);
    return ["TODOS", ...names];
  }, [sessions]);

  const areaOptions = useMemo(() => ["TODAS", ...AREAS], []);
  const sectorOptions = useMemo(() => ["TODOS", ...SECTORS], []);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      const okDate = inDateFilter(dateFilter, s.session.sessionStartedAt);
      const okWorker = workerFilter === "TODOS" ? true : s.session.workerName === workerFilter;
      const okArea = areaFilter === "TODAS" ? true : s.session.area === areaFilter;
      const okSector = sectorFilter === "TODOS" ? true : s.session.sector === sectorFilter;
      return okDate && okWorker && okArea && okSector;
    });
  }, [sessions, dateFilter, workerFilter, areaFilter, sectorFilter]);

  const consolidatedSummary = useMemo(() => {
    const byValor = {};
    const byNatureza = {};
    const byCategoria = {};
    let totalMs = 0;
    let countActivities = 0;

    const perSession = filteredSessions.map((s) => {
      const sessionTotal = calcSessionTotalMs(s.activities);
      return { ...s, totalMs: sessionTotal };
    });

    perSession.forEach((sess) => {
      (sess.activities || []).forEach((a) => {
        const startMs = a.startAt ? new Date(a.startAt).getTime() : null;
        const endMs = a.endAt ? new Date(a.endAt).getTime() : null;
        if (startMs == null || endMs == null) return;

        const ms = Math.max(0, endMs - startMs);
        totalMs += ms;
        countActivities += 1;

        addToMap(byValor, a.classification?.v, ms);
        addToMap(byNatureza, a.classification?.n, ms);
        addToMap(byCategoria, a.classification?.c, ms);
      });
    });

    return {
      perSession,
      countSessions: perSession.length,
      countActivities,
      totalMs,
      totalFormatted: msToHHMMSS(totalMs),
      byValor,
      byNatureza,
      byCategoria,
    };
  }, [filteredSessions]);

  const pctParts = useMemo(() => {
    const total = consolidatedSummary.totalMs || 1;
    const msAgrega = consolidatedSummary.byValor["Agrega valor"] || 0;
    const msInerente = consolidatedSummary.byValor["Inerente"] || 0;
    const msNaoAgrega = consolidatedSummary.byValor["Não agrega valor"] || 0;

    const pct = (ms) => Math.round((ms / total) * 1000) / 10;

    return [
      { label: "Agrega valor", valuePct: pct(msAgrega), color: "#22C55E" },
      { label: "Inerente", valuePct: pct(msInerente), color: "#FACC15" },
      { label: "Não agrega", valuePct: pct(msNaoAgrega), color: "#EF4444" },
    ];
  }, [consolidatedSummary]);

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.h1}>Consolidação</Text>
      <Text style={styles.subtitle}>
        {consolidatedSummary.countSessions} coletas • {consolidatedSummary.countActivities} atividades • Total {consolidatedSummary.totalFormatted}
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Filtros</Text>
        <Selector label="Período" options={DATE_FILTERS} value={dateFilter} onChange={setDateFilter} />
        <Selector label="Colaborador" options={workerOptions} value={workerFilter} onChange={setWorkerFilter} />
        <Selector label="Área" options={areaOptions} value={areaFilter} onChange={setAreaFilter} />
        <Selector label="Setor" options={sectorOptions} value={sectorFilter} onChange={setSectorFilter} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Composição (%) — Valor</Text>
        <StackedPercentBar width={320} height={16} parts={pctParts} />

        <View style={{ marginTop: 10 }}>
          {pctParts.map((p) => (
            <Text key={p.label} style={styles.summaryRow}>
              <Text style={{ color: p.color, fontWeight: "900" }}>■ </Text>
              {p.label}: <Text style={styles.summaryStrong}>{p.valuePct}%</Text>
            </Text>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Top Categorias (tempo)</Text>
        {sortTotalsDesc(consolidatedSummary.byCategoria).slice(0, 8).map(([k, ms]) => (
          <Text key={k} style={styles.summaryRow}>
            {k}: <Text style={styles.summaryStrong}>{msToHHMMSS(ms)}</Text>
          </Text>
        ))}
      </View>

      <View style={{ marginTop: 10 }}>
        <Button
          title="Exportar Consolidação (.xlsx)"
          onPress={() => onExportConsolidatedXLSX(consolidatedSummary)}
          disabled={consolidatedSummary.countSessions === 0}
        />
        <Button title="Voltar" onPress={onBack} variant="ghost" />
      </View>

      {consolidatedSummary.countSessions === 0 && (
        <Text style={styles.helper}>Nenhuma coleta atende aos filtros selecionados.</Text>
      )}
    </ScrollView>
  );
}

/* =========================================================
   7) APP (NAVEGAÇÃO + ESTADO GLOBAL)
========================================================= */
export default function App() {
  // HOME | ENTRY | ACTIVITY | SUMMARY | HISTORY | CONSOLIDATION | SESSION_VIEW
  const [screen, setScreen] = useState("HOME");

  // Sessão atual
  const [session, setSession] = useState(null);
  const [endedAt, setEndedAt] = useState(null);
  const [finalActivities, setFinalActivities] = useState([]);

  // Sessões salvas (histórico + consolidação)
  const [sessions, setSessions] = useState([]);

  // Sessão selecionada no histórico
  const [viewSession, setViewSession] = useState(null);

  // Para o botão "Voltar" da Consolidação: HOME ou HISTORY
  const [consolBack, setConsolBack] = useState("HOME");

  function goHome() {
    setScreen("HOME");
  }

  function startNew() {
    setSession(null);
    setEndedAt(null);
    setFinalActivities([]);
    setScreen("ENTRY");
  }

  function goHistory() {
    setScreen("HISTORY");
  }

  function goConsolidation(from = "HOME") {
    setConsolBack(from);
    setScreen("CONSOLIDATION");
  }

  function startSession(data) {
    setSession(data);
    setEndedAt(null);
    setFinalActivities([]);
    setScreen("ACTIVITY");
  }

  function finishAndGoSummary({ endedAt, activities }) {
    setEndedAt(endedAt);
    setFinalActivities(activities || []);
    setScreen("SUMMARY");

    // salva a sessão finalizada (para histórico/consolidação)
    setSessions((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        session: dataClone(session),
        endedAt,
        activities: activities || [],
      },
    ]);
  }

  // Clonagem simples para evitar referência mutável (segurança)
  function dataClone(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return obj;
    }
  }

  function exportCurrentSessionXLSX(summary) {
    if (!session) return;

    const base = `wrench_time_${safeFileName(session.workerName)}_${safeFileName(session.workOrder)}_${new Date()
      .toISOString()
      .slice(0, 10)}`;
    const filename = `${base}.xlsx`;

    const wb = buildWorkbookSessionXLSX({
      session,
      activities: finalActivities,
      summary: { ...summary, endedAtISO: endedAt },
    });

    const ok = downloadXLSX(filename, wb);
    if (ok) Alert.alert("XLSX gerado", `Download iniciado: ${filename}`);
  }

  function exportConsolidatedXLSX(consolidatedSummary) {
    const filename = `consolidacao_wrench_time_${new Date().toISOString().slice(0, 10)}.xlsx`;

    const wb = buildWorkbookConsolidatedXLSX({
      perSession: consolidatedSummary.perSession,
      consolidatedSummary,
    });

    const ok = downloadXLSX(filename, wb);
    if (ok) Alert.alert("XLSX gerado", `Download iniciado: ${filename}`);
  }

  function openSessionFromHistory(item) {
    setViewSession(item);
    setScreen("SESSION_VIEW");
  }

  // Back da consolidação
  function backFromConsolidation() {
    setScreen(consolBack === "HISTORY" ? "HISTORY" : "HOME");
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          {screen === "HOME" && (
            <HomeScreen
              onStartNew={startNew}
              onGoHistory={goHistory}
              onGoConsolidation={() => goConsolidation("HOME")}
              totalSessions={sessions.length}
            />
          )}

          {screen === "ENTRY" && (
            <EntryScreen
              onSubmit={startSession}
              onBackHome={goHome}
            />
          )}

          {screen === "ACTIVITY" && session && (
            <ActivityScreen
              session={session}
              onFinish={finishAndGoSummary}
              onBack={() => setScreen("ENTRY")}
            />
          )}

          {screen === "SUMMARY" && session && (
            <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
              <Text style={styles.h1}>Resumo (Atual)</Text>
              <Text style={styles.subtitle}>
                {session.workerName} • OS {session.workOrder} • {session.sector} • {session.area}
              </Text>

              {/* resumo renderizado via export, mas simples aqui: */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Ações</Text>
                <Button title="Gerar Excel (.xlsx)" onPress={() => exportCurrentSessionXLSX(buildSummary(session, endedAt, finalActivities))} />
                <Button title="Ver medições realizadas" onPress={goHistory} variant="ghost" />
                <Button title="Consolidação" onPress={() => goConsolidation("HOME")} variant="ghost" />
                <Button title="Voltar ao início" onPress={goHome} variant="ghost" />
              </View>

              {/* Mini detalhes */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Detalhes</Text>
                <Text style={styles.summaryRow}>
                  Início: <Text style={styles.summaryStrong}>{formatDate(session.sessionStartedAt)} {formatTime(session.sessionStartedAt)}</Text>
                </Text>
                <Text style={styles.summaryRow}>
                  Fim: <Text style={styles.summaryStrong}>{formatDate(endedAt)} {formatTime(endedAt)}</Text>
                </Text>
                <Text style={styles.summaryRow}>
                  Atividades: <Text style={styles.summaryStrong}>{finalActivities.length}</Text>
                </Text>
              </View>
            </ScrollView>
          )}

          {screen === "HISTORY" && (
            <HistoryScreen
              sessions={sessions}
              onOpenSession={openSessionFromHistory}
              onGoConsolidation={() => goConsolidation("HISTORY")}
              onBackHome={goHome}
            />
          )}

          {screen === "SESSION_VIEW" && viewSession && (
            <SessionReportView
              item={viewSession}
              onBack={() => setScreen("HISTORY")}
              onGoHome={goHome}
              onGoConsolidation={() => goConsolidation("HISTORY")}
              onExport={(summary) => {
                const s = viewSession.session;
                const filename = `wrench_time_${safeFileName(s.workerName)}_${safeFileName(s.workOrder)}_${toDateYMD(s.sessionStartedAt) || "data"}.xlsx`;
                const wb = buildWorkbookSessionXLSX({
                  session: s,
                  activities: viewSession.activities,
                  summary: { ...summary, endedAtISO: viewSession.endedAt },
                });
                const ok = downloadXLSX(filename, wb);
                if (ok) Alert.alert("XLSX gerado", `Download iniciado: ${filename}`);
              }}
            />
          )}

          {screen === "CONSOLIDATION" && (
            <ConsolidationScreen
              sessions={sessions}
              onBack={backFromConsolidation}
              onExportConsolidatedXLSX={exportConsolidatedXLSX}
            />
          )}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );

  // monta summary para export no resumo rápido (sem duplicar lógica)
  function buildSummary(session, endedAt, activities) {
    const byValor = {};
    const byNatureza = {};
    const byCategoria = {};
    let totalMs = 0;

    (activities || []).forEach((a) => {
      const startMs = a.startAt ? new Date(a.startAt).getTime() : null;
      const endMs = a.endAt ? new Date(a.endAt).getTime() : null;
      if (startMs == null || endMs == null) return;
      const ms = Math.max(0, endMs - startMs);
      totalMs += ms;
      addToMap(byValor, a.classification?.v, ms);
      addToMap(byNatureza, a.classification?.n, ms);
      addToMap(byCategoria, a.classification?.c, ms);
    });

    return {
      countActivities: (activities || []).length,
      totalMs,
      totalFormatted: msToHHMMSS(totalMs),
      endedAtISO: endedAt,
      byValor,
      byNatureza,
      byCategoria,
    };
  }

  // View do histórico com resumo e export
  function SessionReportView({ item, onBack, onGoHome, onGoConsolidation, onExport }) {
    const s = item.session;
    const summary = buildSummary(s, item.endedAt, item.activities);
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        <Text style={styles.h1}>Resumo (Histórico)</Text>
        <Text style={styles.subtitle}>
          {s.workerName} • OS {s.workOrder} • {s.sector} • {s.area}
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Dados</Text>
          <Text style={styles.summaryRow}>
            Acompanhador: <Text style={styles.summaryStrong}>{s.observerName}</Text>
          </Text>
          <Text style={styles.summaryRow}>
            Início: <Text style={styles.summaryStrong}>{formatDate(s.sessionStartedAt)} {formatTime(s.sessionStartedAt)}</Text>
          </Text>
          <Text style={styles.summaryRow}>
            Fim: <Text style={styles.summaryStrong}>{formatDate(item.endedAt)} {formatTime(item.endedAt)}</Text>
          </Text>
          <Text style={styles.summaryRow}>
            Total: <Text style={styles.summaryStrong}>{summary.totalFormatted}</Text>
          </Text>
          <Text style={styles.summaryRow}>
            Atividades: <Text style={styles.summaryStrong}>{item.activities.length}</Text>
          </Text>
        </View>

        <View style={{ marginTop: 10 }}>
          <Button title="Gerar Excel (.xlsx)" onPress={() => onExport(summary)} />
          <Button title="Consolidação" onPress={onGoConsolidation} variant="ghost" />
          <Button title="Voltar" onPress={onBack} variant="ghost" />
          <Button title="Início" onPress={onGoHome} variant="ghost" />
        </View>
      </ScrollView>
    );
  }
}

/* =========================================================
   8) ESTILOS
========================================================= */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1220" },
  container: { flex: 1, padding: 16 },

  homeTitle: {
    color: "white",
    fontSize: 28,
    fontWeight: "900",
    textAlign: "center",
  },
  subtitleCenter: { color: "#9CA3AF", marginTop: 10, textAlign: "center" },

  h1: { color: "white", fontSize: 24, fontWeight: "900" },
  subtitle: { color: "#9CA3AF", marginTop: 6, marginBottom: 10 },

  label: { color: "#E5E7EB", fontSize: 13, marginTop: 12, marginBottom: 6 },

  input: {
    backgroundColor: "#0B1220",
    borderWidth: 1,
    borderColor: "#1F2A44",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    color: "#E5E7EB",
    minHeight: 44,
  },

  helper: { color: "#9CA3AF", marginTop: 8, fontSize: 12 },

  card: {
    marginTop: 10,
    backgroundColor: "#111A2E",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1F2A44",
  },
  cardTitle: { color: "white", fontSize: 15, fontWeight: "900", marginBottom: 6 },

  segmentContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
  },
  segment: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "transparent",
  },
  segmentUnselected: { backgroundColor: "transparent", borderColor: "#334155" },
  segmentText: { color: "#E5E7EB", fontWeight: "800", fontSize: 12 },

  btn: {
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: { backgroundColor: "#2563EB" },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#334155" },
  btnText: { color: "white", fontWeight: "900" },

  activityRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1F2A44",
  },
  activityTitle: { color: "white", fontWeight: "900", fontSize: 14 },
  activityMeta: { color: "#CBD5E1", marginTop: 4, fontSize: 12 },
  activityMetaStrong: { color: "white", fontWeight: "900" },

  summaryRow: { color: "#CBD5E1", marginTop: 6, fontSize: 13 },
  summaryStrong: { color: "white", fontWeight: "900" },

  sessionCard: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1F2A44",
    backgroundColor: "#0B1220",
    marginBottom: 10,
  },
  sessionTitle: { color: "white", fontWeight: "900", fontSize: 14 },
});