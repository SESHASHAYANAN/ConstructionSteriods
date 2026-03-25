import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

/* ── Auth ─────────────────────────────────────────────────────────────────── */
export const login = (email, password) =>
  api.post('/auth/login', { email, password }).then((r) => r.data);

export const getMe = () => api.get('/auth/me').then((r) => r.data);

/* ── Projects ─────────────────────────────────────────────────────────────── */
export const listProjects = () => api.get('/projects').then((r) => r.data);

export const createProject = (data) =>
  api.post('/projects', data).then((r) => r.data);

export const getProject = (id) =>
  api.get(`/projects/${id}`).then((r) => r.data);

export const uploadFiles = (projectId, files) => {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  return api
    .post(`/projects/${projectId}/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    .then((r) => r.data);
};

export const triggerReview = (projectId) =>
  api.post(`/projects/${projectId}/review`).then((r) => r.data);

export const getReviewStatus = (projectId) =>
  api.get(`/projects/${projectId}/review/status`).then((r) => r.data);

export const getProjectIssues = (projectId) =>
  api.get(`/projects/${projectId}/issues`).then((r) => r.data);

export const getProjectNCRs = (projectId) =>
  api.get(`/projects/${projectId}/ncrs`).then((r) => r.data);

export const getProjectRFIs = (projectId) =>
  api.get(`/projects/${projectId}/rfis`).then((r) => r.data);

export const getProjectFiles = (projectId) =>
  api.get(`/projects/${projectId}/files`).then((r) => r.data);

export const getFileUrl = (projectId, fileId) =>
  api.get(`/projects/${projectId}/files/${fileId}/url`).then((r) => r.data);

export const exportReport = (projectId) =>
  api.get(`/export/${projectId}/pdf-advanced`, { responseType: 'blob' }).then((r) => r.data);

/* ── Issues ───────────────────────────────────────────────────────────────── */
export const updateIssue = (issueId, status) =>
  api.patch(`/issues/${issueId}`, { status }).then((r) => r.data);

export const createNCR = (issueId) =>
  api.post(`/issues/${issueId}/ncr`).then((r) => r.data);

export const createRFI = (issueId) =>
  api.post(`/issues/${issueId}/rfi`).then((r) => r.data);

export const applyIssueFix = (issueId) =>
  api.post(`/issues/${issueId}/apply-fix`).then((r) => r.data);

export const uploadIssueImage = (issueId, file, annotationData) => {
  const form = new FormData();
  form.append('file', file);
  form.append('annotation_x', annotationData?.x || 0);
  form.append('annotation_y', annotationData?.y || 0);
  form.append('annotation_radius', annotationData?.radius || 30);
  return api.post(`/issues/${issueId}/image`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((r) => r.data);
};

export const getIssueImage = (issueId) =>
  api.get(`/issues/${issueId}/image`).then((r) => r.data);

export const getIssueImageUrl = (issueId) =>
  `${API_BASE}/issues/${issueId}/image/file`;

export const getIssueVersions = (issueId) =>
  api.get(`/issues/${issueId}/versions`).then((r) => r.data);

export const getProjectAuditLog = (projectId) =>
  api.get(`/projects/${projectId}/audit-log`).then((r) => r.data);

export const getProjectDrawingImage = (projectId) =>
  api.get(`/projects/${projectId}/drawing-image`).then((r) => r.data);

export const getDrawingImageUrl = (projectId) =>
  `${API_BASE}/uploads`;

export const exportReportDocx = (projectId) =>
  api.get(`/projects/${projectId}/report/docx`, { responseType: 'blob' }).then((r) => r.data);

/* ── Spec / Review ────────────────────────────────────────────────────────── */
export const generateSpec = async (projectId, discipline) => {
  try {
    const res = await api.post(
      '/spec/generate',
      { project_id: projectId, discipline },
      { responseType: 'blob', timeout: 120000 }
    );
    return res.data;
  } catch (err) {
    // Extract error message from the response
    if (err.response) {
      const status = err.response.status;
      let message = 'Spec generation failed.';
      if (err.response.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const parsed = JSON.parse(text);
          message = parsed.detail || message;
        } catch {
          // ignore parse error
        }
      } else if (err.response.data?.detail) {
        message = err.response.data.detail;
      }
      if (status === 504) {
        throw new Error('AI service timed out. Please try again in a moment.');
      }
      throw new Error(message);
    }
    if (err.code === 'ECONNABORTED') {
      throw new Error('Request timed out after 2 minutes. The AI service may be overloaded.');
    }
    throw new Error('Network error. Please check your connection and try again.');
  }
};

export const reviewWord = (text) =>
  api.post('/review/word', { text }).then((r) => r.data);

export const reviewExcel = (data, sheetName) =>
  api.post('/review/excel', { data, sheet_name: sheetName }).then((r) => r.data);

/* ── SSE: Live Review Progress Stream ────────────────────────────────────── */
export function connectReviewSSE(projectId, onMessage, onError) {
  const url = `${API_BASE}/projects/${projectId}/review/stream`;
  let retryCount = 0;
  const MAX_RETRIES = 5;
  const BASE_DELAY = 2000;
  let currentSource = null;
  let closed = false;

  function connect() {
    if (closed) return;
    currentSource = new EventSource(url);

    currentSource.onmessage = (event) => {
      try {
        retryCount = 0;
        const data = JSON.parse(event.data);
        onMessage(data);

        if (data.status === 'Complete' || data.status === 'Failed') {
          closed = true;
          currentSource.close();
        }
      } catch {
        // SSE parse error — silently ignore
      }
    };

    currentSource.onerror = (err) => {
      currentSource.close();

      if (closed) return;

      retryCount++;
      if (retryCount <= MAX_RETRIES) {
        const delay = BASE_DELAY * retryCount;
        setTimeout(connect, delay);
      } else {
        if (onError) onError(err);
      }
    };
  }

  connect();

  // Return close function for cleanup
  return () => {
    closed = true;
    if (currentSource) currentSource.close();
  };
}

/* ── Settings ─────────────────────────────────────────────────────────────── */
export const getProjectSettings = (projectId) =>
  api.get(`/projects/${projectId}/settings`).then((r) => r.data);

export const updateProjectSettings = (projectId, data) =>
  api.put(`/projects/${projectId}/settings`, data).then((r) => r.data);

/* ── Material Analysis ───────────────────────────────────────────────────── */
export const getMaterialStandards = () =>
  api.get('/materials/standards').then((r) => r.data);

export const analyzeMaterial = (file, materialType, expectedSpec) => {
  const form = new FormData();
  form.append('file', file);
  form.append('material_type', materialType);
  form.append('expected_spec', expectedSpec);
  return api.post('/materials/analyze', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  }).then((r) => r.data);
};

/* ── Smart Procurement ───────────────────────────────────────────────────── */
export const analyzeProcurement = (items, region, budgetPreference) =>
  api.post('/procurement/analyze', { items, region, budget_preference: budgetPreference }, { timeout: 120000 }).then((r) => r.data);

/* ── Predictive Code Compliance ──────────────────────────────────────────── */
export const getBuildingCodes = () =>
  api.get('/compliance/codes').then((r) => r.data);

export const predictCompliance = (text, buildingCodes, discipline) =>
  api.post('/compliance/predict', { text, building_codes: buildingCodes, discipline }, { timeout: 120000 }).then((r) => r.data);

export const predictComplianceUpload = (file, buildingCodes, discipline) => {
  const form = new FormData();
  form.append('file', file);
  form.append('building_codes', buildingCodes.join(','));
  form.append('discipline', discipline);
  return api.post('/compliance/predict-upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  }).then((r) => r.data);
};

export default api;
