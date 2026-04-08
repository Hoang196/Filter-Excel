import { useState, useMemo } from "react";
import {
  Upload,
  Button,
  Table,
  Tabs,
  Tag,
  message,
  Modal,
  Spin,
  Tooltip,
  Empty,
  Badge,
  Input,
} from "antd";
import {
  UploadOutlined,
  ExportOutlined,
  FilterOutlined,
  EyeOutlined,
  InboxOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import * as XLSX from "xlsx";
import "./App.css";

// ================= CONSTANTS =================
const UNKNOWN_AGE = 999;
const MAX_FILE_SIZE_MB = 10;
const SHEET_TP = "QH TP";
const SHEET_PTP = "QH PTP";

// ================= TYPES =================
type SheetType = "tp" | "ptp";

interface Employee {
  stt: string;
  id: string;
  name: string;
  dob: Date | null;
  yearJoinBIDV: Date | null;
  education: string;
  scores: string[];
  rawEducation: string;
  rawScores: string;
  rawDob: string;
  rawYearJoinBIDV: string;
}

interface Result extends Employee {
  status: "PASS" | "FAIL";
  reasons: string[];
  overridden?: boolean;
  overrideReason?: string;
}

interface SheetData {
  employees: Employee[];
  results: Result[];
}

// ================= UTILS =================
const normalize = (v?: string) => v?.toLowerCase().trim() || "";

const parseDate = (value: unknown): Date | null => {
  if (value == null || value === "") return null;
  try {
    if (typeof value === "number") {
      const d = XLSX.SSF.parse_date_code(value);
      return new Date(d.y, d.m - 1, d.d);
    }
    const str = String(value).trim();
    const ddMM = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (ddMM) return new Date(+ddMM[3], +ddMM[2] - 1, +ddMM[1]);
    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
};

const calcAge = (dob: Date | null, planYear: number): number => {
  if (!dob) return UNKNOWN_AGE;
  return planYear - dob.getFullYear();
};

const calcWorkingYears = (joinDate: Date | null, planYear: number): number => {
  if (!joinDate) return 0;
  return planYear - joinDate.getFullYear();
};

const formatDate = (d?: Date | null) =>
  d
    ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`
    : "";

const parseScores = (s: string): string[] => {
  const lines = s
    .split(/[\n\r]+/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"));
  const scores: { year: number; score: string }[] = [];
  for (const line of lines) {
    const match = line.match(/^- (\d{4}):\s*(.+)/);
    if (match) scores.push({ year: +match[1], score: match[2].trim() });
  }
  scores.sort((a, b) => a.year - b.year);
  return scores.map((s) => s.score);
};

const isGoodScore = (score: string): boolean => {
  const s = normalize(score);
  return (
    s === "tốt" ||
    s === "xuất sắc" ||
    s.includes("hoàn thành tốt") ||
    s.includes("hoàn thành xuất sắc")
  );
};

const isQualifiedEducation = (edu: string): boolean => {
  const e = normalize(edu);
  return (
    e.includes("chính quy") ||
    e.includes("thạc sĩ") ||
    e.includes("tiến sĩ") ||
    e.includes("phó giáo sư") ||
    e.includes("giáo sư")
  );
};

// ================= RULE ENGINE =================
const RULES: Record<SheetType, { maxAge: number; label: string }> = {
  tp: { maxAge: 46, label: "Trưởng phòng" },
  ptp: { maxAge: 37, label: "Phó Trưởng phòng" },
};
const MIN_WORKING_YEARS = 2;

const evaluateEmployee = (
  e: Employee,
  type: SheetType,
  planYear: number,
): Result => {
  const reasons: string[] = [];
  const rule = RULES[type];

  const last2 = e.scores.slice(-2);
  if (last2.length < 2 || !last2.every(isGoodScore)) {
    reasons.push(
      "Không đáp ứng kết quả xếp loại (yêu cầu Hoàn thành tốt nhiệm vụ 2 năm liền kề)",
    );
  }

  if (!isQualifiedEducation(e.education)) {
    reasons.push(
      "Không đáp ứng trình độ chuyên môn (yêu cầu ĐH chính quy hoặc Thạc sĩ trở lên)",
    );
  }

  if (!e.dob) {
    reasons.push("Thiếu ngày sinh");
  } else {
    const age = calcAge(e.dob, planYear);
    if (age > rule.maxAge) {
      reasons.push(`Quá tuổi (${age} tuổi, tối đa ${rule.maxAge} tuổi)`);
    }
  }

  if (!e.yearJoinBIDV) {
    reasons.push("Thiếu năm vào BIDV");
  } else {
    const years = calcWorkingYears(e.yearJoinBIDV, planYear);
    if (years < MIN_WORKING_YEARS) {
      reasons.push(
        `Không đủ ${MIN_WORKING_YEARS} năm công tác tại BIDV (${years} năm)`,
      );
    }
  }

  return { ...e, status: reasons.length ? "FAIL" : "PASS", reasons };
};

// ================= COLUMN MAP =================
const COLUMN_MAP = {
  stt: "STT",
  id: "Mã nhân viên",
  name: "Họ và tên",
  dob: "Ngày sinh",
  yearJoinBIDV: "Năm vào BIDV",
  education: "Trình độ đào tạo",
  scores: "Kết quả xếp loại HTNV",
};

// ================= PARSER =================
const parseSheet = (wb: XLSX.WorkBook, sheetName: string): Employee[] => {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
  if (json.length < 2) return [];

  const headers = (json[0] as unknown[]).map((h) => String(h || "").trim());
  const allCols = Object.values(COLUMN_MAP);
  const missing = allCols.filter((c) => !headers.includes(c));
  if (missing.length) {
    throw new Error(`Sheet "${sheetName}" thiếu cột: ${missing.join(", ")}`);
  }

  const str = (v: unknown) => (v == null ? "" : String(v).trim());
  return json
    .slice(1)
    .filter(
      (row) =>
        Array.isArray(row) &&
        (str(row[headers.indexOf(COLUMN_MAP.id)]) ||
          str(row[headers.indexOf(COLUMN_MAP.name)])),
    )
    .map((row) => {
      const getVal = (col: string) => {
        const idx = headers.indexOf(col);
        return idx === -1 ? "" : str((row as unknown[])[idx]);
      };
      const rawDob = getVal(COLUMN_MAP.dob);
      const rawYear = getVal(COLUMN_MAP.yearJoinBIDV);
      const rawEdu = getVal(COLUMN_MAP.education);
      const rawScores = getVal(COLUMN_MAP.scores);
      return {
        stt: getVal(COLUMN_MAP.stt),
        id: getVal(COLUMN_MAP.id),
        name: getVal(COLUMN_MAP.name),
        dob: parseDate(rawDob),
        yearJoinBIDV: parseDate(rawYear),
        education: rawEdu,
        scores: parseScores(rawScores),
        rawDob,
        rawYearJoinBIDV: rawYear,
        rawEducation: rawEdu,
        rawScores,
      };
    });
};

const parseExcel = (file: File): Promise<{ tp: Employee[]; ptp: Employee[] }> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "array" });
        const hasTP = wb.SheetNames.includes(SHEET_TP);
        const hasPTP = wb.SheetNames.includes(SHEET_PTP);
        if (!hasTP && !hasPTP) {
          reject(
            new Error(
              `Không tìm thấy sheet "${SHEET_TP}" hoặc "${SHEET_PTP}" trong file`,
            ),
          );
          return;
        }
        const tp = hasTP ? parseSheet(wb, SHEET_TP) : [];
        const ptp = hasPTP ? parseSheet(wb, SHEET_PTP) : [];
        if (!tp.length && !ptp.length) {
          reject(new Error("Không có dòng dữ liệu hợp lệ trong cả 2 sheet"));
          return;
        }
        resolve({ tp, ptp });
      } catch (err) {
        reject(
          err instanceof Error ? err : new Error(`Không thể đọc file: ${err}`),
        );
      }
    };
    reader.onerror = () => reject(new Error("Lỗi đọc file"));
    reader.readAsArrayBuffer(file);
  });

// ================= EXPORT =================
const mapExport = (r: Result, planYear: number) => ({
  STT: r.stt,
  "Mã nhân viên": r.id,
  "Họ và tên": r.name,
  "Ngày sinh": r.rawDob,
  "Năm vào BIDV": r.rawYearJoinBIDV,
  "Số năm công tác": r.yearJoinBIDV
    ? calcWorkingYears(r.yearJoinBIDV, planYear)
    : "",
  "Trình độ đào tạo": r.rawEducation,
  "Kết quả xếp loại HTNV": r.rawScores,
  "Kết quả": r.status === "PASS" ? "Đạt" : "Không đạt",
  "Lý do không đạt": r.reasons.join("; "),
  "Lý do chuyển đổi": r.overrideReason || "",
});

// ================= APP =================
export default function App() {
  const [sheets, setSheets] = useState<Record<SheetType, SheetData>>({
    tp: { employees: [], results: [] },
    ptp: { employees: [], results: [] },
  });
  const [activeSheet, setActiveSheet] = useState<SheetType>("ptp");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<{
    sheet: SheetType;
    id: string;
    name: string;
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const planYear = new Date().getFullYear();

  const hasData =
    sheets.tp.employees.length > 0 || sheets.ptp.employees.length > 0;

  const handleUpload = async (file: File) => {
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      message.error(`File quá lớn (tối đa ${MAX_FILE_SIZE_MB}MB)`);
      return false;
    }
    if (hasData) {
      return new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: "Upload file mới?",
          content: "Dữ liệu và kết quả hiện tại sẽ bị thay thế.",
          okText: "Tiếp tục",
          cancelText: "Hủy",
          onOk: async () => {
            await doUpload(file);
            resolve(false);
          },
          onCancel: () => resolve(false),
        });
      });
    }
    await doUpload(file);
    return false;
  };

  const doUpload = async (file: File) => {
    setLoading(true);
    try {
      const { tp, ptp } = await parseExcel(file);
      setSheets({
        tp: { employees: tp, results: [] },
        ptp: { employees: ptp, results: [] },
      });
      const total = tp.length + ptp.length;
      message.success(
        `Upload thành công: ${total} cán bộ (TP: ${tp.length}, PTP: ${ptp.length})`,
      );
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const check = () => {
    setSheets((prev) => {
      const next = { ...prev };
      for (const key of ["tp", "ptp"] as SheetType[]) {
        const s = prev[key];
        if (s.employees.length) {
          next[key] = {
            ...s,
            results: s.employees.map((e) => evaluateEmployee(e, key, planYear)),
          };
        }
      }
      return next;
    });
    message.success("Hoàn tất rà soát cả 2 sheet");
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    for (const key of ["tp", "ptp"] as SheetType[]) {
      const s = sheets[key];
      if (!s.results.length) continue;
      const label = key === "tp" ? "TP" : "PTP";
      const passData = s.results.filter((r) => r.status === "PASS");
      const failData = s.results.filter((r) => r.status === "FAIL");

      const addSheet = (data: Result[], name: string) => {
        const rows = data.map((r) => mapExport(r, planYear));
        const ws = XLSX.utils.json_to_sheet(rows);
        ws["!cols"] = [
          { wch: 5 }, // STT
          { wch: 14 }, // Mã NV
          { wch: 25 }, // Họ tên
          { wch: 14 }, // Ngày sinh
          { wch: 14 }, // Năm vào BIDV
          { wch: 10 }, // Số năm CT
          { wch: 50 }, // Trình độ
          { wch: 35 }, // XL HTNV
          { wch: 12 }, // Kết quả
          { wch: 60 }, // Lý do không đạt
          { wch: 40 }, // Lý do chuyển đổi
        ];
        XLSX.utils.book_append_sheet(wb, ws, name);
      };

      addSheet(passData, `${label} - Đạt`);
      addSheet(failData, `${label} - Không đạt`);
    }
    if (!wb.SheetNames.length) {
      message.warning("Chưa có kết quả để xuất");
      return;
    }
    XLSX.writeFile(wb, `KetQua_RaSoat_${planYear}.xlsx`);
  };

  const handleOverride = (sheet: SheetType, r: Result) => {
    setOverrideTarget({ sheet, id: r.id, name: r.name });
    setOverrideReason("");
  };

  const confirmOverride = () => {
    if (!overrideTarget || !overrideReason.trim()) {
      message.warning("Vui lòng nhập lý do chuyển đổi");
      return;
    }
    setSheets((prev) => {
      const key = overrideTarget.sheet;
      const updated = prev[key].results.map((r) => {
        if (r.id === overrideTarget.id && r.name === overrideTarget.name) {
          return {
            ...r,
            status: (r.status === "PASS" ? "FAIL" : "PASS") as "PASS" | "FAIL",
            overridden: true,
            overrideReason: overrideReason.trim(),
          };
        }
        return r;
      });
      return { ...prev, [key]: { ...prev[key], results: updated } };
    });
    message.success(
      `Đã chuyển trạng thái ${overrideTarget.name} (${overrideTarget.id})`,
    );
    setOverrideTarget(null);
    setOverrideReason("");
  };

  const resultColumns = useMemo(
    () => [
      { title: "STT", dataIndex: "stt", width: 60 },
      { title: "Mã NV", dataIndex: "id", width: 100 },
      { title: "Họ và tên", dataIndex: "name", width: 160 },
      {
        title: "Ngày sinh",
        width: 110,
        render: (_: unknown, r: Result) => formatDate(r.dob),
      },
      {
        title: "Năm vào BIDV",
        width: 120,
        render: (_: unknown, r: Result) => formatDate(r.yearJoinBIDV),
      },
      { title: "Trình độ", dataIndex: "education", width: 160, ellipsis: true },
      {
        title: "XL HTNV",
        width: 180,
        render: (_: unknown, r: Result) => r.scores.join(" | "),
      },
      {
        title: "Kết quả",
        width: 120,
        render: (_: unknown, r: Result) => (
          <>
            {r.status === "PASS" ? (
              <Tag color="green">Đạt</Tag>
            ) : (
              <Tag color="red">Không đạt</Tag>
            )}
            {r.overridden && <Tag color="orange">Đã chuyển</Tag>}
          </>
        ),
      },
      {
        title: "Lý do không đạt",
        width: 250,
        render: (_: unknown, r: Result) =>
          r.reasons.length ? (
            <Tooltip title={r.reasons.join("; ")}>
              <span style={{ color: "#cf1322" }}>{r.reasons.join("; ")}</span>
            </Tooltip>
          ) : (
            "—"
          ),
      },
      {
        title: "Lý do chuyển đổi",
        width: 200,
        render: (_: unknown, r: Result) =>
          r.overrideReason ? (
            <Tooltip title={r.overrideReason}>
              <span style={{ color: "#d46b08" }}>{r.overrideReason}</span>
            </Tooltip>
          ) : (
            "—"
          ),
      },
      {
        title: "Thao tác",
        width: 120,
        fixed: "right" as const,
        render: (_: unknown, r: Result) => (
          <Button
            size="small"
            icon={<SwapOutlined />}
            onClick={() => handleOverride(activeSheet, r)}
          >
            Chuyển
          </Button>
        ),
      },
    ],
    [activeSheet],
  );

  const previewColumns = useMemo(
    () => [
      { title: "STT", dataIndex: "stt", width: 60 },
      { title: "Mã NV", dataIndex: "id", width: 100 },
      { title: "Họ và tên", dataIndex: "name", width: 160 },
      {
        title: "Ngày sinh",
        width: 110,
        render: (_: unknown, r: Employee) => formatDate(r.dob),
      },
      {
        title: "Năm vào BIDV",
        width: 120,
        render: (_: unknown, r: Employee) => formatDate(r.yearJoinBIDV),
      },
      { title: "Trình độ", dataIndex: "education", width: 160, ellipsis: true },
      {
        title: "XL HTNV",
        width: 180,
        render: (_: unknown, r: Employee) => r.scores.join(" | "),
      },
    ],
    [],
  );

  const paginationConfig = {
    defaultPageSize: 10,
    showSizeChanger: true,
    pageSizeOptions: [10, 20, 50, 100],
    showTotal: (t: number) => `Tổng: ${t}`,
  };

  const makeResultTabs = (
    passData: Result[],
    failData: Result[],
    allData: Result[],
  ) => [
    {
      key: "pass",
      label: `Đạt điều kiện (${passData.length})`,
      children: (
        <Table
          dataSource={passData}
          columns={resultColumns}
          rowKey={(r, i) => `${r.id}-${r.name}-${i}`}
          scroll={{ x: 1100 }}
          pagination={paginationConfig}
          locale={{ emptyText: <Empty description="Chưa có dữ liệu." /> }}
        />
      ),
    },
    {
      key: "fail",
      label: `Không đạt (${failData.length})`,
      children: (
        <Table
          dataSource={failData}
          columns={resultColumns}
          rowKey={(r, i) => `${r.id}-${r.name}-${i}`}
          scroll={{ x: 1100 }}
          pagination={paginationConfig}
          locale={{
            emptyText: <Empty description="Không có cán bộ nào không đạt." />,
          }}
        />
      ),
    },
    {
      key: "all",
      label: `Tất cả (${allData.length})`,
      children: (
        <Table
          dataSource={allData}
          columns={resultColumns}
          rowKey={(r, i) => `${r.id}-${r.name}-${i}`}
          scroll={{ x: 1100 }}
          pagination={paginationConfig}
          locale={{ emptyText: <Empty description="Chưa có dữ liệu." /> }}
        />
      ),
    },
  ];

  const sheetTabs = [
    {
      key: "ptp",
      label: (
        <span>
          QH Phó Trưởng phòng{" "}
          <Badge
            count={sheets.ptp.employees.length}
            style={{ backgroundColor: "#2b6cb0" }}
            overflowCount={9999}
          />
        </span>
      ),
      children: (
        <>
          {sheets.ptp.results.length > 0 && activeSheet === "ptp" && (
            <div className="stats-row" style={{ marginBottom: 16 }}>
              <div className="stat-item total">
                <div className="stat-label">Tổng rà soát</div>
                <div className="stat-value">{sheets.ptp.results.length}</div>
              </div>
              <div className="stat-item pass">
                <div className="stat-label">Đạt điều kiện</div>
                <div className="stat-value">
                  {sheets.ptp.results.filter((r) => r.status === "PASS").length}
                </div>
              </div>
              <div className="stat-item fail">
                <div className="stat-label">Không đạt</div>
                <div className="stat-value">
                  {sheets.ptp.results.filter((r) => r.status === "FAIL").length}
                </div>
              </div>
            </div>
          )}
          <Tabs
            defaultActiveKey="pass"
            items={makeResultTabs(
              sheets.ptp.results.filter((r) => r.status === "PASS"),
              sheets.ptp.results.filter((r) => r.status === "FAIL"),
              sheets.ptp.results,
            )}
          />
        </>
      ),
    },
    {
      key: "tp",
      label: (
        <span>
          QH Trưởng phòng{" "}
          <Badge
            count={sheets.tp.employees.length}
            style={{ backgroundColor: "#2b6cb0" }}
            overflowCount={9999}
          />
        </span>
      ),
      children: (
        <>
          {sheets.tp.results.length > 0 && activeSheet === "tp" && (
            <div className="stats-row" style={{ marginBottom: 16 }}>
              <div className="stat-item total">
                <div className="stat-label">Tổng rà soát</div>
                <div className="stat-value">{sheets.tp.results.length}</div>
              </div>
              <div className="stat-item pass">
                <div className="stat-label">Đạt điều kiện</div>
                <div className="stat-value">
                  {sheets.tp.results.filter((r) => r.status === "PASS").length}
                </div>
              </div>
              <div className="stat-item fail">
                <div className="stat-label">Không đạt</div>
                <div className="stat-value">
                  {sheets.tp.results.filter((r) => r.status === "FAIL").length}
                </div>
              </div>
            </div>
          )}
          <Tabs
            defaultActiveKey="pass"
            items={makeResultTabs(
              sheets.tp.results.filter((r) => r.status === "PASS"),
              sheets.tp.results.filter((r) => r.status === "FAIL"),
              sheets.tp.results,
            )}
          />
        </>
      ),
    },
  ];

  return (
    <div className="layout">
      <header className="header">
        <h2>Rà soát điều kiện quy hoạch cán bộ</h2>
        <span className="subtitle">BIDV - HR Internal Tool</span>
      </header>

      <main className="content">
        {/* Upload zone */}
        {!hasData && (
          <Upload.Dragger
            beforeUpload={handleUpload}
            showUploadList={false}
            accept=".xlsx,.xls"
            className="upload-zone"
          >
            <p className="upload-icon">
              <InboxOutlined />
            </p>
            <p className="upload-title">
              Kéo thả file Excel vào đây hoặc bấm để chọn file
            </p>
            <p className="upload-hint">
              Hỗ trợ .xlsx, .xls — File cần có sheet "{SHEET_PTP}" và/hoặc "
              {SHEET_TP}"
            </p>
          </Upload.Dragger>
        )}

        {/* Toolbar */}
        {hasData && (
          <div className="card">
            <div className="toolbar">
              <Upload
                beforeUpload={handleUpload}
                showUploadList={false}
                accept=".xlsx,.xls"
              >
                <Button
                  size="large"
                  icon={<UploadOutlined />}
                  loading={loading}
                >
                  Đổi file
                </Button>
              </Upload>
              <Button
                type="primary"
                size="large"
                icon={<FilterOutlined />}
                onClick={check}
                disabled={loading}
              >
                Rà soát
              </Button>
              <Button
                size="large"
                icon={<EyeOutlined />}
                onClick={() => setPreviewOpen(true)}
              >
                Xem dữ liệu
              </Button>
              <Button
                size="large"
                icon={<ExportOutlined />}
                onClick={exportExcel}
                color="green"
                variant="solid"
                disabled={
                  (!sheets.tp.results.length && !sheets.ptp.results.length) ||
                  loading
                }
              >
                Xuất Excel
              </Button>
              <span className="toolbar-info">
                TP: <strong>{sheets.tp.employees.length}</strong> &nbsp;|&nbsp;
                PTP: <strong>{sheets.ptp.employees.length}</strong>
              </span>
            </div>
          </div>
        )}

        {/* Results */}
        {hasData && (
          <div className="card table-card">
            <Spin spinning={loading}>
              <Tabs
                activeKey={activeSheet}
                onChange={(k) => setActiveSheet(k as SheetType)}
                items={sheetTabs}
                type="card"
                size="large"
              />
            </Spin>
          </div>
        )}
      </main>

      <footer className="footer">
        © {new Date().getFullYear()} BIDV - Rà soát quy hoạch cán bộ
      </footer>

      {/* Preview Modal */}
      <Modal
        title={`Dữ liệu đầu vào — ${activeSheet === "tp" ? "QH Trưởng phòng" : "QH Phó Trưởng phòng"}`}
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={null}
        width={1200}
        centered
        styles={{ body: { maxHeight: "70vh", overflow: "auto" } }}
      >
        <Tabs
          items={[
            {
              key: "ptp",
              label: `QH PTP (${sheets.ptp.employees.length})`,
              children: (
                <Table
                  dataSource={sheets.ptp.employees}
                  columns={previewColumns}
                  rowKey={(r) => `${r.id}-${r.name}`}
                  scroll={{ x: 900 }}
                  pagination={{ pageSize: 15 }}
                />
              ),
            },
            {
              key: "tp",
              label: `QH TP (${sheets.tp.employees.length})`,
              children: (
                <Table
                  dataSource={sheets.tp.employees}
                  columns={previewColumns}
                  rowKey={(r) => `${r.id}-${r.name}`}
                  scroll={{ x: 900 }}
                  pagination={{ pageSize: 15 }}
                />
              ),
            },
          ]}
        />
      </Modal>

      {/* Override Modal */}
      <Modal
        title="Chuyển đổi trạng thái"
        open={!!overrideTarget}
        onCancel={() => {
          setOverrideTarget(null);
          setOverrideReason("");
        }}
        onOk={confirmOverride}
        okButtonProps={{ disabled: !overrideReason.trim() }}
        okText="Xác nhận"
        cancelText="Hủy"
        centered
        width={600}
      >
        {overrideTarget && (
          <div>
            <p>
              Chuyển trạng thái của <strong>{overrideTarget.name}</strong> (
              {overrideTarget.id}) từ{" "}
              <Tag
                color={
                  sheets[overrideTarget.sheet].results.find(
                    (r) =>
                      r.id === overrideTarget.id &&
                      r.name === overrideTarget.name,
                  )?.status === "PASS"
                    ? "green"
                    : "red"
                }
              >
                {sheets[overrideTarget.sheet].results.find(
                  (r) =>
                    r.id === overrideTarget.id &&
                    r.name === overrideTarget.name,
                )?.status === "PASS"
                  ? "Đạt"
                  : "Không đạt"}
              </Tag>{" "}
              sang{" "}
              <Tag
                color={
                  sheets[overrideTarget.sheet].results.find(
                    (r) =>
                      r.id === overrideTarget.id &&
                      r.name === overrideTarget.name,
                  )?.status === "PASS"
                    ? "red"
                    : "green"
                }
              >
                {sheets[overrideTarget.sheet].results.find(
                  (r) =>
                    r.id === overrideTarget.id &&
                    r.name === overrideTarget.name,
                )?.status === "PASS"
                  ? "Không đạt"
                  : "Đạt"}
              </Tag>
            </p>
            <Input.TextArea
              rows={3}
              placeholder="Nhập lý do chuyển đổi..."
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              autoFocus
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
