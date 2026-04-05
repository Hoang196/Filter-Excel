import { useState } from "react";
import {
  Upload,
  Button,
  Table,
  Tabs,
  Tag,
  message,
  Select,
  Modal,
  Statistic,
  Row,
  Col,
  Spin,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import * as XLSX from "xlsx";
import "./App.css";

const { TabPane } = Tabs;

// ================= TYPES =================
interface Employee {
  id: string;
  name: string;
  dob: Date;
  education: string;
  startDate: Date;
  scores: string[];
  position?: string;
  positionDuration?: number;
  examScore?: number;
}

interface Result extends Employee {
  status: "PASS" | "FAIL";
  reasons: string[];
}

type Rule = {
  maxAge: number;
  minYears: number;
  minPositionMonths: number;
  requireExam: boolean;
  minExam?: number;
};

// ================= UTILS =================
const normalize = (v?: string) => v?.toLowerCase().trim() || "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseDate = (value: any): Date => {
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    return new Date(d.y, d.m - 1, d.d);
  }
  return new Date(value);
};

const calcAge = (dob: Date) => new Date().getFullYear() - dob.getFullYear();

const calcYears = (date: Date) => new Date().getFullYear() - date.getFullYear();

// ================= RULE CONFIG =================
const RULES: Record<string, Rule> = {
  truong_phong: {
    maxAge: 46,
    minYears: 2,
    minPositionMonths: 6,
    requireExam: false,
  },
  pho_phong: {
    maxAge: 37,
    minYears: 2,
    minPositionMonths: 6,
    requireExam: true,
    minExam: 70,
  },
};

// ================= RULE ENGINE =================
const evaluateEmployee = (e: Employee, type: string): Result => {
  const reasons: string[] = [];
  const rule = RULES[type];

  const age = calcAge(e.dob);
  const years = calcYears(e.startDate);

  // 2 năm gần nhất (không phụ thuộc thứ tự)
  const last2 = e.scores.slice(-2).map(normalize);
  if (!last2.every((s) => s === "tốt")) {
    reasons.push("Không đạt xếp loại 2 năm");
  }

  // trình độ
  const edu = normalize(e.education);
  if (!edu.includes("đại học") && !edu.includes("thạc sĩ")) {
    reasons.push("Không đạt trình độ");
  }

  // tuổi + năm
  if (age > rule.maxAge) reasons.push("Quá tuổi");
  if (years < rule.minYears) reasons.push("Chưa đủ năm công tác");

  // chức vụ đúng loại
  const pos = normalize(e.position);
  if (type === "truong_phong" && !pos.includes("phó")) {
    reasons.push("Chưa đúng chức vụ");
  }
  if (type === "pho_phong" && !pos.includes("chuyên viên")) {
    reasons.push("Chưa đạt cấp chuyên viên");
  }

  // thời gian giữ
  if ((e.positionDuration || 0) < rule.minPositionMonths) {
    reasons.push("Chưa đủ thời gian giữ chức");
  }

  // điểm thi
  if (rule.requireExam && (e.examScore || 0) < (rule.minExam || 0)) {
    reasons.push("Điểm < 70");
  }

  return {
    ...e,
    status: reasons.length ? "FAIL" : "PASS",
    reasons,
  };
};

// ================= PARSER =================
const parseExcel = (file: File): Promise<Employee[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "binary" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json = XLSX.utils.sheet_to_json<any>(sheet);

        const data: Employee[] = json.map((row) => ({
          id: row["Mã cán bộ"]?.toString().trim(),
          name: row["Họ và tên"]?.toString().trim(),
          dob: parseDate(row["Ngày sinh"]),
          education: row["Trình độ"],
          startDate: parseDate(row["Ngày vào"]),
          scores: [row["Năm 1"], row["Năm 2"], row["Năm 3"]],
          position: row["Chức vụ"],
          positionDuration: Number(row["Thời gian giữ chức"]),
          examScore: Number(row["Điểm"]),
        }));

        resolve(data);
      } catch {
        reject();
      }
    };

    reader.readAsBinaryString(file);
  });
};

// ================= APP =================
export default function App() {
  const [data, setData] = useState<Employee[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [type, setType] = useState("truong_phong");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleUpload = async (file: File) => {
    try {
      const parsed = await parseExcel(file);
      setData(parsed);
      message.success("Upload thành công");
    } catch {
      message.error("File không hợp lệ");
    }
    return false;
  };

  const check = () => {
    setLoading(true);
    setTimeout(() => {
      const res = data.map((e) => evaluateEmployee(e, type));
      setResults(res);
      setLoading(false);
    }, 300);
  };

  const exportExcel = () => {
    if (!results.length) return message.warning("Chưa có dữ liệu");

    const pass = results.filter((r) => r.status === "PASS");
    const fail = results.filter((r) => r.status === "FAIL");

    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pass), "Dat");

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        fail.map((f) => ({
          ...f,
          reasons: f.reasons.join(", "),
        })),
      ),
      "KhongDat",
    );

    XLSX.writeFile(wb, "ket_qua_loc.xlsx");
  };

  const pass = results.filter((r) => r.status === "PASS");
  const fail = results.filter((r) => r.status === "FAIL");

  const columns = [
    { title: "Mã", dataIndex: "id" },
    { title: "Tên", dataIndex: "name" },
    {
      title: "Kết quả",
      render: (r: Result) =>
        r.status === "PASS" ? (
          <Tag color="green">Đạt</Tag>
        ) : (
          <Tag color="red">Không đạt</Tag>
        ),
    },
    {
      title: "Lý do",
      render: (r: Result) => r.reasons.join(", "),
    },
  ];

  return (
    <div className="layout">
      {/* HEADER */}
      <header className="header">
        <div className="header-left">
          <h2>Rà soát quy hoạch cán bộ</h2>
          <span className="subtitle">HR Internal Tool</span>
        </div>
      </header>

      {/* BODY */}
      <main className="content">
        {/* FILTER */}
        <div className="card">
          <Row gutter={16}>
            <Col span={6}>
              <Select
                style={{ width: "100%" }}
                value={type}
                onChange={setType}
                options={[
                  { value: "truong_phong", label: "Trưởng phòng" },
                  { value: "pho_phong", label: "Phó phòng" },
                ]}
              />
            </Col>

            <Col>
              <Upload beforeUpload={handleUpload} showUploadList={false}>
                <Button icon={<UploadOutlined />}>Upload</Button>
              </Upload>
            </Col>

            <Col>
              <Button type="primary" onClick={check} disabled={!data.length}>
                Lọc
              </Button>
            </Col>

            <Col>
              <Button onClick={() => setPreviewOpen(true)}>Preview</Button>
            </Col>

            <Col>
              <Button onClick={exportExcel}>Export</Button>
            </Col>
          </Row>
        </div>

        {/* STATS */}
        <div className="card">
          <Row gutter={16}>
            <Col span={8}>
              <Statistic title="Tổng" value={results.length} />
            </Col>
            <Col span={8}>
              <Statistic title="Đạt" value={pass.length} />
            </Col>
            <Col span={8}>
              <Statistic title="Không đạt" value={fail.length} />
            </Col>
          </Row>
        </div>

        {/* TABLE */}
        <div className="card">
          <Spin spinning={loading}>
            <Tabs>
              <TabPane tab="Đạt" key="1">
                <Table dataSource={pass} columns={columns} rowKey="id" />
              </TabPane>

              <TabPane tab="Không đạt" key="2">
                <Table dataSource={fail} columns={columns} rowKey="id" />
              </TabPane>
            </Tabs>
          </Spin>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="footer">© 2026 HR Tool - Internal</footer>

      {/* MODAL */}
      <Modal
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={null}
        width={900}
      >
        <Table dataSource={data} rowKey="id" />
      </Modal>
    </div>
  );
}
