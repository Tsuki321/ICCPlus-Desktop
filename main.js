const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { startServer } = require('./server');
const { name } = require('./package.json');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const log = require('electron-log');
const Store = require('electron-store').default;
const contextMenu = require('electron-context-menu').default;

const store = new Store();
const PORT = 42007;
let MIGRATION_FILE;
let mainWindow;
let server;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
    return;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 900,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            autoplayPolicy: 'no-user-gesture-required',
        },
        icon: path.join(__dirname, './assets/icons/png/64x64.png')
    });

    const migrated = store.get('idbMigratedToApp') && !fs.existsSync(MIGRATION_FILE);
    if (migrated) {
        mainWindow.loadURL(`http://localhost:${PORT}`);
    } else {
        mainWindow.loadFile('index.html');
    }
	
	mainWindow.webContents.on('will-prevent-unload', (event) => {
		const options = {
			type: 'question',
			buttons: ['Stay', 'Leave'],
			message: 'Are you sure you want to leave?',
			detail: 'Changes that you made may not be saved.',
		};
		const response = dialog.showMessageBoxSync(mainWindow, options)
		if (response === 1) event.preventDefault();
	});

    setupAutoUpdater();
}

function setupAutoUpdater() {
    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = 'info';

    autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'wahaha303',
        repo: 'ICCPlus-Desktop',
        token: process.env.AUTO_UPDATE_TOKEN
    });
	
	autoUpdater.autoDownload = false;
    autoUpdater.checkForUpdates();
}

app.whenReady().then(async () => {
    contextMenu();
    try {
        try {
            const result = await startServer(PORT);
            server = result.server;
        } catch (err) {
            if (err.code === 'EADDRINUSE') {
                dialog.showErrorBox('Port In Use', `port ${PORT} is already using in other program.\nPlease exit it and try again.`);
                app.quit();
                return;
            } else {
                throw err;
            }
        }
        MIGRATION_FILE = path.join(app.getPath('userData'), 'idb-migration.json');
        createWindow();
    } catch (err) {
        dialog.showErrorBox('Application Error', err.message);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('before-quit', () => {
    if (server) {
        server.close();
    }
});

autoUpdater.on('update-available', () => {
    log.info('Update available.');
    if (mainWindow) {
        mainWindow.webContents.send('update-available');
    }
});

autoUpdater.on('update-not-available', () => {
    log.info('Update not available.');
});

autoUpdater.on('error', (error) => {
    log.error('Error in auto-updater:', error);
});

ipcMain.on('idb-exported', (_, data) => {
    fs.writeFileSync(MIGRATION_FILE, JSON.stringify(data), 'utf-8');
});

ipcMain.on('open-update-page', (_, url) => {
    shell.openExternal(url);
});

ipcMain.on('switch-to-localhost', () => {
    if (store.get('idbMigratedToApp')) return;
    mainWindow.loadURL(`http://localhost:${PORT}`);
});

ipcMain.handle('get-migrated-idb-data', async () => {
    if (!fs.existsSync(MIGRATION_FILE)) return null;

    return JSON.parse(fs.readFileSync(MIGRATION_FILE, 'utf-8'));
});

ipcMain.on('idb-import-success', () => {
    if (fs.existsSync(MIGRATION_FILE)) {
        fs.unlinkSync(MIGRATION_FILE);
    }

    store.set('idbMigratedToApp', true);
    
    setTimeout(() => {
        app.relaunch();
        app.exit(0);
    }, 3000);
});

/* -----------------------------------------------------------------------
 * OCR — Extracts text from an image data URL using Windows built-in OCR
 * (Windows.Media.Ocr via PowerShell WinRT). No additional dependencies.
 * ----------------------------------------------------------------------- */
ipcMain.handle('ocr-image', async (event, dataUrl) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
        throw new Error('Invalid image data provided to OCR.');
    }

    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const timestamp = Date.now();
    const imgPath = path.join(os.tmpdir(), `icc_ocr_${timestamp}.png`);
    const ps1Path = path.join(os.tmpdir(), `icc_ocr_${timestamp}.ps1`);

    // PowerShell script using Windows.Media.Ocr (WinRT) — works on Windows 10+
    // Reads file bytes via .NET File.ReadAllBytes to avoid WinRT COM-type conversion
    // issues with StorageFile.OpenReadAsync() returning System.__ComObject.
    const ps1Script = `
param([string]$imagePath)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType=WindowsRuntime]
[void][Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
[void][Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType=WindowsRuntime]
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod
})[0]
function Await {
    param($WinRtTask, $ResultType)
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait() | Out-Null
    $netTask.Result
}
try {
    $bytes = [System.IO.File]::ReadAllBytes($imagePath)
    $stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
    $writer = [Windows.Storage.Streams.DataWriter]::new($stream)
    $writer.WriteBytes($bytes)
    Await ($writer.StoreAsync()) ([System.UInt32]) | Out-Null
    $writer.DetachStream()
    $stream.Seek(0)
    $decode = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decode.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $engine) { exit 0 }
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $result.Lines | ForEach-Object { $_.Text }
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
`.trim();

    try {
        fs.writeFileSync(imgPath, Buffer.from(base64Data, 'base64'));
        fs.writeFileSync(ps1Path, ps1Script, 'utf-8');

        return await new Promise((resolve, reject) => {
            execFile(
                'powershell.exe',
                ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path, imgPath],
                { timeout: 30000 },
                (error, stdout, stderr) => {
                    if (error) {
                        reject(new Error((stderr || error.message || 'OCR failed').trim()));
                    } else {
                        resolve(stdout.trim());
                    }
                }
            );
        });
    } finally {
        try { fs.unlinkSync(ps1Path); } catch {}
        try { fs.unlinkSync(imgPath); } catch {}
    }
});