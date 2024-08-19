const { app, BrowserWindow, ipcMain, globalShortcut, clipboard, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const axios = require('axios');
const screenshot = require('screenshot-desktop');
const fs = require('fs');
const temp = require('temp').track();
const FormData = require('form-data');

let tray;
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 320,
    height: 240,
    frame: false,
    resizable: false,
    autoHideMenuBar: true,
    alwaysOnTop: false,
    //skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.setSkipTaskbar(true); // Hide from the taskbar
      mainWindow.hide();
    }
  });
  createTray();
}


function toggleAlwaysOnTop() {
  const isAlwaysOnTop = mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(!isAlwaysOnTop);
  return !isAlwaysOnTop;
}

function createTray() {

  const iconPath = path.join(__dirname, 'assets/icon_full.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });

  if (icon.isEmpty()) {
    console.error('Failed to load tray icon');
  }


  tray = new Tray(icon);
  tray.setToolTip('OCR App');
  // Function to update the context menu
  const updateContextMenu = () => {
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: 'Show App',
        click: () => {
          mainWindow.setSkipTaskbar(false); // Show in the taskbar
          mainWindow.show();
        },
      },
      {
        label: 'Hide App',
        click: () => {
          mainWindow.setSkipTaskbar(true); // Hide from the taskbar
          mainWindow.hide();
        },
      },
      {
        label: 'Always On Top',
        type: 'checkbox',
        checked: mainWindow.isAlwaysOnTop(),
        click: (menuItem) => {
          menuItem.checked = toggleAlwaysOnTop();
        },
      },
      {
        label: 'Quit',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]));
  };

  updateContextMenu();
}

async function performOCR(imgBuffer) {
  console.log('Performing OCR...');
  // Write the image buffer to a temporary file
  const tempFilePath = temp.path({ suffix: '.png' });
  await fs.promises.writeFile(tempFilePath, imgBuffer);
  console.log('Temporary file path:', tempFilePath);

  try {
    // Form data
    let form = new FormData();
    form.append('file', fs.createReadStream(tempFilePath));

    console.log('Sending OCR Request...')

    // Send the file to the OCR server
    const response = await axios.post('http://localhost:8000/ocr/', form, {
      headers: form.getHeaders(),
    });

    // Clean up the temporary file
    await fs.promises.unlink(tempFilePath);
    console.log('Temporary file cleaned up.')

    // Validate response data
    if (response.data && response.data.extracted_text) {
      const ocrText = response.data.extracted_text;
      clipboard.writeText(ocrText);
      console.log('Copied to clipboard.');

      // Send the OCR result to the renderer process
      mainWindow.webContents.send('ocr-result', ocrText);

    } else {
      throw new Error('OCR response is missing extracted_text');
    }
  } catch (error) {
    console.error('Error performing OCR:', error);
  }
}

app.whenReady().then(async () => {
  createWindow();

// Register a global shortcut for capturing a screenshot (e.g., 'CmdOrCtrl+Shift+S')
  globalShortcut.register('CmdOrCtrl+Shift+S', async () => {
    try {
      const imgBuffer = await screenshot({ format: 'png' }); // Directly get buffer
      await performOCR(imgBuffer);
    } catch (error) {
      console.error('Error capturing screenshot or performing OCR:', error);
    }
  });
});


ipcMain.on('file-upload', async (event, filePath) => {
  try {
    console.log('Received file upload for path: ', filePath);
    if (fs.existsSync(filePath)) {
      const imgBuffer = await fs.promises.readFile(filePath);
      await performOCR(imgBuffer);
    } else {
      throw new Error(`File not found: ${filePath}`);
    }
  } catch (error) {
    console.error('Error processing uploaded file:', error);
  }
});

// Handle "hide window" IPC message
ipcMain.on('hide-window', () => {
  console.log('hide-window event received');
  mainWindow.setSkipTaskbar(true); // Hide from the taskbar
  mainWindow.hide();
});

// Handle "copy to clipboard" IPC message
ipcMain.on('copy-to-clipboard', (event, text) => {
  console.log('copy-to-clipboard event received with text:', text);
  clipboard.writeText(text);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});