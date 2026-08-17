import type { TripSummary } from "../types";

export interface RiskAxisResult {
  key: string;
  label: string;
  emoji: string;
  rawValue: number;
  unit: string;
  score: number; // 0-100, chuẩn hoá để vẽ radar
  comment: string;
}

// Ngưỡng "trần 100%" cho mỗi trục radar - lấy từ MEAN của scenario
// "dangerous" trong ml/generate_synthetic_data.py (chính là dataset dùng
// train model risk scoring). Ý nghĩa: đạt/vượt mức này ~ tương đương 1
// chuyến bị coi là nguy hiểm trung bình trên tập huấn luyện, không phải
// số bịa random.
//
// LƯU Ý: nếu sau này retrain model với SCENARIO_DISTRIBUTIONS khác (đổi
// mean/sd), phải cập nhật lại số ở đây bằng tay - file này KHÔNG tự sync
// với ml/generate_synthetic_data.py. Cùng loại rủi ro "2 nơi lệch nhau"
// đã gặp với satelliteLayers.js (checkpoint v25, mục 2.5).
const DANGEROUS_CEILING = {
  hard_brake_per_min: 1.1,
  rapid_accel_per_min: 0.9,
  sharp_turn_per_min: 0.55,
  overspeed_ratio: 0.33,
} as const;

function normalize(value: number, ceiling: number): number {
  if (!Number.isFinite(value) || ceiling <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / ceiling) * 100)));
}

function tier(score: number): 0 | 1 | 2 | 3 {
  if (score < 20) return 0;
  if (score < 50) return 1;
  if (score < 80) return 2;
  return 3;
}

// 4 câu/trục, tăng dần mức độ "cà khịa" theo tier (0=thấp -> 3=cao).
const COMMENTS: Record<string, [string, string, string, string]> = {
  hard_brake: [
    "Phanh êm như đang chở trứng, đáng khen.",
    "Thỉnh thoảng phanh gấp - chắc có ai băng qua đường bất ngờ.",
    "Phanh gấp hơi nhiều - não bộ và chân phanh đang cãi nhau.",
    "Phanh như đang né jump-scare phim kinh dị. Nhẹ chân thôi bro.",
  ],
  rapid_accel: [
    "Tăng tốc từ tốn, đúng chuẩn tài xế nhà lành.",
    "Thi thoảng đạp ga hơi hăng - vội đón khách hả?",
    "Tăng tốc kiểu này chắc xăng cũng phải giật mình.",
    "Đạp ga như đang thi Fast & Furious. Xe cho thuê chứ không phải xe đua.",
  ],
  sharp_turn: [
    "Cua mượt như tay lái lụa thứ thiệt.",
    "Vài cú cua hơi gắt - chắc đang né ổ gà tưởng tượng.",
    "Cua gắt khá thường xuyên - vô lăng nó cũng mỏi tay đấy.",
    "Cua như đang né vỏ chuối trong Mario Kart. Bớt gắt lại giùm.",
  ],
  overspeed: [
    "Tốc độ chuẩn chỉnh, gần như không vượt ngưỡng.",
    "Có vài đoạn hơi vượt tốc - chắc đường đang vắng quá.",
    "Vượt tốc khá nhiều đoạn trong chuyến này - ga lẹ tay ghê.",
    "Đi như đang đua F1 mà quên mất đây là xe cho thuê.",
  ],
};

const FINAL_COMMENTS: Record<"safe" | "medium" | "dangerous", string> = {
  safe: "Chuyến này an toàn, hồ sơ lái xe của mày đang rất đẹp 👍",
  medium: 'Ổn áp phần lớn, chỉ vài chỗ hơi "nhiệt tình". Giữ phong độ nhé.',
  dangerous:
    "Chuyến này mà đưa hội đồng chấm chắc cũng phải lắc đầu. Chạy chill lại đi 🙏",
};

const AXIS_CONFIGS: Array<{
  key: keyof typeof DANGEROUS_CEILING;
  commentKey: string;
  label: string;
  emoji: string;
  unit: string;
}> = [
  {
    key: "hard_brake_per_min",
    commentKey: "hard_brake",
    label: "Phanh gấp",
    emoji: "🤬",
    unit: "lần/phút",
  },
  {
    key: "rapid_accel_per_min",
    commentKey: "rapid_accel",
    label: "Tăng tốc",
    emoji: "😌",
    unit: "lần/phút",
  },
  {
    key: "sharp_turn_per_min",
    commentKey: "sharp_turn",
    label: "Cua gắt",
    emoji: "😁",
    unit: "lần/phút",
  },
  {
    key: "overspeed_ratio",
    commentKey: "overspeed",
    label: "Vượt tốc",
    emoji: "🥹",
    unit: "% thời gian",
  },
];

export function buildRiskBreakdown(
  summary: TripSummary,
  riskLevel: "safe" | "medium" | "dangerous" | undefined,
): { axes: RiskAxisResult[]; finalComment: string } {
  const axes: RiskAxisResult[] = AXIS_CONFIGS.map((cfg) => {
    const rawValue = summary[cfg.key];
    const score = normalize(rawValue, DANGEROUS_CEILING[cfg.key]);
    const comment = COMMENTS[cfg.commentKey][tier(score)];
    // overspeed_ratio lưu dạng 0-1 (vd 0.13) - hiển thị % cho dễ đọc,
    // 3 trục kia là per-min, giữ nguyên số thập phân.
    const displayValue =
      cfg.key === "overspeed_ratio"
        ? Math.round(rawValue * 1000) / 10 // 0.13 -> 13.0
        : rawValue;
    return {
      key: cfg.commentKey,
      label: cfg.label,
      emoji: cfg.emoji,
      rawValue: displayValue,
      unit: cfg.unit,
      score,
      comment,
    };
  });

  const finalComment = riskLevel ? FINAL_COMMENTS[riskLevel] : "";

  return { axes, finalComment };
}
