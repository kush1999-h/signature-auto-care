import axios from "axios";

export const AUTH_LOGOUT_EVENT = "sac:logout";

const isProd = process.env.NODE_ENV === "production";
const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || (isProd ? "" : "http://localhost:3001");
if (!apiBaseUrl) {
  throw new Error("NEXT_PUBLIC_API_URL is required in production");
}

const api = axios.create({
  baseURL: apiBaseUrl
});

export function getPdfBaseUrl() {
  const baseUrl = process.env.NEXT_PUBLIC_PDF_URL || (isProd ? "" : "http://localhost:8001");
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_PDF_URL is required in production");
  }
  return baseUrl;
}

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const data = error?.response?.data;
    const status = error?.response?.status;
    if (status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(AUTH_LOGOUT_EVENT, { detail: { reason: "unauthorized" } }));
    }
    const message =
      typeof data?.message === "string"
        ? data.message
        : Array.isArray(data?.message)
        ? data.message.join(", ")
        : data?.error || "Request failed";
    return Promise.reject({
      message,
      status,
      data
    });
  }
);

export function setAuthToken(token?: string) {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common["Authorization"];
  }
}

export default api;
