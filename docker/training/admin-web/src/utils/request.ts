import axios, { type AxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'

const instance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 10000
})

// 2026-08-12: 4in1 作 IdP, 同 origin localStorage 共享 'token' key (与 4in1 主页一致)
const ADMIN_TOKEN_KEY = 'token'
instance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY)
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 拦截器返回 response.data 进行拆包，但 TypeScript 无法感知这一转换
// 因此通过下面的包装器重新声明返回类型
instance.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      // 401 清掉 4in1 token, 让父窗口重新登录
      localStorage.removeItem(ADMIN_TOKEN_KEY)
      ElMessage.error('登录已过期, 请返回 4in1 主页重新登录')
      try {
        if (window.parent && window.parent !== window) {
          window.parent.location.href = '/'
        } else {
          window.location.href = '/'
        }
      } catch {
        window.location.href = '/'
      }
    }
    return Promise.reject(error)
  }
)

const request = {
  get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return instance.get(url, config) as unknown as Promise<T>
  },
  post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    return instance.post(url, data, config) as unknown as Promise<T>
  },
  put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    return instance.put(url, data, config) as unknown as Promise<T>
  },
  patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    return instance.patch(url, data, config) as unknown as Promise<T>
  },
  delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return instance.delete(url, config) as unknown as Promise<T>
  },
}

export default request
