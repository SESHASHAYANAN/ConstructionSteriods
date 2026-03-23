import { create } from 'zustand';

export const useAuthStore = create((set) => ({
  user: null,
  token: localStorage.getItem('token') || null,
  isAuthenticated: !!localStorage.getItem('token'),

  setAuth: (user, token) => {
    localStorage.setItem('token', token);
    set({ user, token, isAuthenticated: true });
  },

  setUser: (user) => set({ user }),

  logout: () => {
    localStorage.removeItem('token');
    set({ user: null, token: null, isAuthenticated: false });
  },
}));

export const useProjectStore = create((set) => ({
  activeProjectId: null,
  setActiveProject: (id) => set({ activeProjectId: id }),
}));

export const useUIStore = create((set) => ({
  issueDrawerOpen: false,
  selectedIssue: null,
  createProjectOpen: false,
  issueModalOpen: false,
  selectedModalIssue: null,
  modalContext: null, // 'issue' | 'ncr' | 'rfi'

  openIssueDrawer: (issue) => set({ issueDrawerOpen: true, selectedIssue: issue }),
  closeIssueDrawer: () => set({ issueDrawerOpen: false, selectedIssue: null }),
  toggleCreateProject: () => set((s) => ({ createProjectOpen: !s.createProjectOpen })),
  openIssueModal: (issue, context = 'issue') => set({ issueModalOpen: true, selectedModalIssue: issue, modalContext: context }),
  closeIssueModal: () => set({ issueModalOpen: false, selectedModalIssue: null, modalContext: null }),
}));
