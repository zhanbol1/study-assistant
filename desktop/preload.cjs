const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "study",
  Object.freeze({
    snapshot: () => ipcRenderer.invoke("study:snapshot"),
    saveMemory: (content, revision) => ipcRenderer.invoke("study:memory-save", content, revision),
    revealMemory: () => ipcRenderer.invoke("study:memory-reveal"),
    savePage: input => ipcRenderer.invoke("study:page-save", input),
    deletePage: (id, revision) => ipcRenderer.invoke("study:page-delete", id, revision),
    revealDownload: id => ipcRenderer.invoke("study:download-reveal", id),
    saveSettings: (input) => ipcRenderer.invoke("study:settings", input),
    aiStatus: () => ipcRenderer.invoke("study:ai-status"),
    connectAi: (input) => ipcRenderer.invoke("study:ai-connect", input),
    disconnectAi: () => ipcRenderer.invoke("study:ai-disconnect"),
    signInChatGpt: (options) => ipcRenderer.invoke("study:chatgpt-sign-in", options),
    cancelChatGptSignIn: () => ipcRenderer.invoke("study:chatgpt-cancel"),
    signOutChatGpt: () => ipcRenderer.invoke("study:chatgpt-sign-out"),
    refreshChatGptModels: () => ipcRenderer.invoke("study:chatgpt-models"),
    selectChatGptModel: (id) => ipcRenderer.invoke("study:chatgpt-model", id),
    acknowledgeChatGptWelcome: () => ipcRenderer.invoke("study:chatgpt-welcome"),
    openChatGptUsage: () => ipcRenderer.invoke("study:chatgpt-usage"),
    sendMessage: (input) => ipcRenderer.invoke("study:ai-send", input),
    cancelMessage: () => ipcRenderer.invoke("study:ai-cancel"),
    onProgress: callback => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on("study:ai-progress", listener);
      return () => ipcRenderer.removeListener("study:ai-progress", listener);
    },
    clearChat: () => ipcRenderer.invoke("study:clear-chat"),
    addDocument: (input) => ipcRenderer.invoke("study:add-document", input),
    deleteDocument: (id) => ipcRenderer.invoke("study:delete-document", id),
    searchDocuments: (query) => ipcRenderer.invoke("study:search-documents", query),
    importDocument: (course) => ipcRenderer.invoke("study:import-document", course),
    onSnapshot: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on("study:changed", listener);
      return () => ipcRenderer.removeListener("study:changed", listener);
    },
    onOpenSettings: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("study:open-settings", listener);
      return () => ipcRenderer.removeListener("study:open-settings", listener);
    },
    openSource: (url) => ipcRenderer.invoke("study:open-source", url),
  }),
);
