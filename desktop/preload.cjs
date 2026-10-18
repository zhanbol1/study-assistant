const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "study",
  Object.freeze({
    snapshot: () => ipcRenderer.invoke("study:snapshot"),
    addTask: (input) => ipcRenderer.invoke("study:add-task", input),
    updateTask: (id, input) => ipcRenderer.invoke("study:update-task", id, input),
    toggleTask: (id) => ipcRenderer.invoke("study:toggle-task", id),
    deleteTask: (id) => ipcRenderer.invoke("study:delete-task", id),
    addRoutine: (input) => ipcRenderer.invoke("study:add-routine", input),
    deleteRoutine: (id) => ipcRenderer.invoke("study:delete-routine", id),
    setRoutineSchedule: (id, cadence) => ipcRenderer.invoke("study:routine-schedule", id, cadence),
    runRoutine: (id) => ipcRenderer.invoke("study:run-routine", id),
    saveSettings: (input) => ipcRenderer.invoke("study:settings", input),
    markNoticesRead: () => ipcRenderer.invoke("study:read-notices"),
    aiStatus: () => ipcRenderer.invoke("study:ai-status"),
    connectAi: (input) => ipcRenderer.invoke("study:ai-connect", input),
    disconnectAi: () => ipcRenderer.invoke("study:ai-disconnect"),
    sendMessage: (input) => ipcRenderer.invoke("study:ai-send", input),
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
    syncCourses: () => ipcRenderer.invoke("study:sync-courses"),
    syncAssignments: (id) => ipcRenderer.invoke("study:sync-assignments", id),
    openSource: (url) => ipcRenderer.invoke("study:open-source", url),
  }),
);
