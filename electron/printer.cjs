/**
 * 打印机管理模块
 *
 * 提供打印机列表查询、打印、导出 PDF 功能。
 * 所有方法为静态方法，无需实例化。
 * 通过 IPC 供渲染进程调用。
 */

const { BrowserWindow, ipcMain } = require('electron');

class PrinterManager {
  /**
   * 获取主窗口实例
   * 优先返回可见/聚焦的窗口，否则返回第一个可用窗口
   */
  static _getMainWindow() {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) {
      throw new Error('没有可用的 BrowserWindow 窗口');
    }
    return win;
  }

  /**
   * 获取系统打印机列表
   * @returns {Promise<Array<{name, displayName, description, status, isDefault}>>}
   */
  static async listPrinters() {
    const win = PrinterManager._getMainWindow();
    const printers = await win.webContents.getPrintersAsync();
    return printers.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      description: p.description,
      status: p.status,
      isDefault: p.isDefault,
    }));
  }

  /**
   * 打印当前页面
   * @param {Object} options
   * @param {boolean} [options.silent=false] - 静默打印（不弹系统对话框）
   * @param {boolean} [options.printBackground=false] - 是否打印背景色/图片
   * @param {string}  [options.deviceName] - 打印机名称（空则使用默认打印机）
   * @param {number}  [options.copies=1] - 打印份数
   * @param {string}  [options.pageSize='A4'] - 纸张大小
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  static async print(options = {}) {
    const win = PrinterManager._getMainWindow();

    const printOptions = {
      silent: options.silent ?? false,
      printBackground: options.printBackground ?? false,
      copies: options.copies ?? 1,
      pageSize: options.pageSize ?? 'A4',
    };

    if (options.deviceName) {
      printOptions.deviceName = options.deviceName;
    }

    return new Promise((resolve) => {
      win.webContents.print(printOptions, (success, failureReason) => {
        if (success) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: failureReason || '打印失败' });
        }
      });
    });
  }

  /**
   * 导出当前页面为 PDF
   * @param {Object} options - printToPDF 选项
   * @returns {Promise<{success: boolean, data?: Buffer, error?: string}>}
   */
  static async exportPDF(options = {}) {
    try {
      const win = PrinterManager._getMainWindow();
      const data = await win.webContents.printToPDF(options);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message || 'PDF 导出失败' };
    }
  }

  /**
   * 注册 IPC handler，供渲染进程调用
   */
  static registerIPC() {
    ipcMain.handle('printer_list', async () => {
      return PrinterManager.listPrinters();
    });

    ipcMain.handle('printer_print', async (_event, options) => {
      return PrinterManager.print(options);
    });

    ipcMain.handle('printer_export_pdf', async (_event, options) => {
      return PrinterManager.exportPDF(options);
    });

    console.log('[PrinterManager] IPC handlers 已注册');
  }
}

module.exports = { PrinterManager };
