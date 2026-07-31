import type { TenantBrandConfig } from "../pipeline/types.ts";

const baseImages = {
  family: [
    "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1511895426328-dc8714191300?auto=format&fit=crop&w=1200&q=80",
    "https://images.pexels.com/photos/3760067/pexels-photo-3760067.jpeg?auto=compress&cs=tinysrgb&w=1200",
  ],
  education: [
    "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=1200&q=80",
    "https://images.pexels.com/photos/5212700/pexels-photo-5212700.jpeg?auto=compress&cs=tinysrgb&w=1200",
  ],
  retire: [
    "https://images.pexels.com/photos/3768131/pexels-photo-3768131.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/7551611/pexels-photo-7551611.jpeg?auto=compress&cs=tinysrgb&w=1200",
  ],
  company: [
    "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80",
    "https://images.pexels.com/photos/325229/pexels-photo-325229.jpeg?auto=compress&cs=tinysrgb&w=1200",
  ],
  finance: [
    "https://picsum.photos/seed/ctf-finance-1/1200/800",
    "https://picsum.photos/seed/ctf-finance-2/1200/800",
    "https://picsum.photos/seed/ctf-finance-3/1200/800",
    "https://picsum.photos/seed/ctf-finance-4/1200/800",
    "https://picsum.photos/seed/ctf-finance-5/1200/800",
  ],
  shield: [
    "https://images.pexels.com/photos/7579831/pexels-photo-7579831.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/7176319/pexels-photo-7176319.jpeg?auto=compress&cs=tinysrgb&w=1200",
  ],
};

export const TENANT_CONFIGS: Record<string, TenantBrandConfig> = {
  default: {
    tenantId: "default",
    companyName: "保险规划中心",
    colors: { primary: "#12304c", secondary: "#b89246", accent: "#2f6fb2", bgStart: "#f6efe3", bgEnd: "#eef4fb" },
    fontFamily: "'Avenir Next','PingFang SC','Microsoft YaHei',sans-serif",
    imageWhitelist: baseImages,
  },
  ctf: {
    tenantId: "ctf",
    companyName: "周大福人寿",
    colors: { primary: "#0f2841", secondary: "#c59a49", accent: "#2f6fb2", bgStart: "#f5efe3", bgEnd: "#edf4fb" },
    fontFamily: "'Avenir Next','PingFang SC','Microsoft YaHei',sans-serif",
    imageWhitelist: baseImages,
    companyIntro: "周大福人寿提供保障、储蓄与传承规划服务，定位长期家庭财富与保障管理。",
    companyRating: ["Fitch 财务实力评级: A-", "Moody's 财务实力评级: A3", "香港RBC偿付能力充足率: 282%"],
  }
  ,
  aia: {
    tenantId: "aia",
    companyName: "友邦保险",
    colors: { primary: "#7f1724", secondary: "#b89246", accent: "#2f6fb2", bgStart: "#fbf6ef", bgEnd: "#f3e9df" },
    fontFamily: "'Avenir Next','PingFang SC','Microsoft YaHei',sans-serif",
    imageWhitelist: baseImages,
    companyIntro: "友邦保险提供长期储蓄、保障与财富传承方案。公司介绍页仅使用已入库资料和可追溯公开来源。",
  }
};

export function getTenantConfig(tenantId: string): TenantBrandConfig {
  return TENANT_CONFIGS[tenantId] || TENANT_CONFIGS.default;
}
