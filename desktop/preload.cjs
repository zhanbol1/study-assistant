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
    syncCourses: () => ipcRenderer.invoke("study:sync-courses"),
    syncAssignments: (id) => ipcRenderer.invoke("study:sync-assignments", id),
    openSource: (url) => ipcRenderer.invoke("study:open-source", url),
  }),
);
