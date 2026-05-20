const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readFile:    ()      => ipcRenderer.invoke('read-file'),
  getConfig:   ()      => ipcRenderer.invoke('get-config'),
  saveConfig:  (cfg)   => ipcRenderer.invoke('save-config', cfg),

  onFileChange: (cb) => {
    const h = () => cb();
    ipcRenderer.on('file-changed', h);
    return () => ipcRenderer.removeListener('file-changed', h);
  },

  // 窗口位置 + 尺寸（同时读写）
  getBounds: ()    => ipcRenderer.invoke('win-get-bounds'),
  setBounds: (b)   => ipcRenderer.send('win-set-bounds', b),

  minimize: ()     => ipcRenderer.send('window-minimize'),
  close:    ()     => ipcRenderer.send('window-close'),
  setTop:   (f)    => ipcRenderer.send('window-set-top', f),

  // 数据文件
  getFileInfo:  ()  => ipcRenderer.invoke('get-file-info'),
  chooseFile:   ()  => ipcRenderer.invoke('choose-file'),
  setDataFile:  (p) => ipcRenderer.invoke('set-data-file', p)
});
