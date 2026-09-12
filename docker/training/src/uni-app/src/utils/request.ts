// 文件路径: src/utils/request.ts

// 🌍 核心 1：智能获取 BASE_URL
const _computeBaseUrl = () => {
  const LAN_IP = '192.168.3.223'; // 这是你 Mac 的局域网 IP
  const PORT = '3000';
  const API_PREFIX = '/api';      // 你的后端统一路由前缀

  try {
    const sys = uni.getSystemInfoSync();
    // 如果是电脑的微信开发者工具，走 127.0.0.1 绕过 Mac 防火墙回环限制
    if (sys.platform === 'devtools') {
      return `http://localhost:${PORT}${API_PREFIX}`;
    }
    // 如果是手机真机调试，走局域网 IP 直连你的 Mac
    return `http://${LAN_IP}:${PORT}${API_PREFIX}`;
  } catch (e) {
    // 兜底方案
    return `http://${LAN_IP}:${PORT}${API_PREFIX}`;
  }
};

const BASE_URL = _computeBaseUrl();
console.log('🚀 当前网络环境 API 地址初始化为:', BASE_URL);

interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: any;
  header?: Record<string, string>;
}

// 🛡️ 核心 2：请求核心逻辑与全局拦截
export const request = <T = any>(options: RequestOptions): Promise<T> => {
  return new Promise((resolve, reject) => {

    // 自动处理路径拼接，防止业务代码里少写或多写斜杠
    const cleanUrl = options.url.startsWith('/') ? options.url : `/${options.url}`;

    uni.request({
      url: BASE_URL + cleanUrl,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        'Content-Type': 'application/json',
        // 注入鉴权 Token
        'Authorization': 'Bearer ' + (uni.getStorageSync('token') || ''),
        ...(options.header || {})
      },
      success: (res: any) => {
        // [状态码 200-299] 业务成功
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        }
        // [状态码 401] 未授权/Token过期
        else if (res.statusCode === 401) {
          uni.removeStorageSync('token');
          uni.removeStorageSync('userId');
          uni.showToast({ title: '身份已过期，请重新登录', icon: 'none' });
          setTimeout(() => {
            uni.reLaunch({ url: '/pages/login/index' });
          }, 1000);
          reject(res);
        }
        // [其他状态码] 业务失败 (如 400, 404, 500)
        else {
          console.error(`[API 业务异常] 请求 ${cleanUrl} 失败:`, res);
          uni.showToast({ title: res.data?.message || '请求失败，请稍后重试', icon: 'none' });
          reject(res);
        }
      },
      fail: (err: any) => {
        console.error(`[网络底层挂断] 无法连接到 ${BASE_URL}:`, err);
        uni.showToast({ title: '网络断开，请检查WiFi与电脑防火墙', icon: 'none' });
        reject(err);
      }
    });
  });
};

// 📦 核心 3：快捷调用方法导出
export const get = <T = any>(url: string, data?: any, header?: Record<string, string>) => request<T>({ url, method: 'GET', data, header });
export const post = <T = any>(url: string, data?: any, header?: Record<string, string>) => request<T>({ url, method: 'POST', data, header });
export const put = <T = any>(url: string, data?: any, header?: Record<string, string>) => request<T>({ url, method: 'PUT', data, header });
export const del = <T = any>(url: string, data?: any, header?: Record<string, string>) => request<T>({ url, method: 'DELETE', data, header });

// 导出 getBaseUrl 供其他模块复用（拼接视频/文件等静态资源路径时使用）
export const getBaseUrl = () => BASE_URL;

export default request;
