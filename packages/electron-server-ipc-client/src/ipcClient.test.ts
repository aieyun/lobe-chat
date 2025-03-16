// ElectronIpcClient.test.ts
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ElectronIpcClient } from './ipcClient';
import { ElectronIPCMethods } from './type';

// Mock node modules
vi.mock('node:fs');
vi.mock('node:net');
vi.mock('node:os');
vi.mock('node:path');

describe('ElectronIpcClient', () => {
  // Mock data
  const mockTempDir = '/mock/temp/dir';
  const mockSocketInfoPath = '/mock/temp/dir/lobechat-electron-ipc-info.json';
  const mockSocketInfo = { socketPath: '/mock/socket/path' };

  // Mock socket
  const mockSocket = {
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };

  beforeEach(() => {
    // Use fake timers
    vi.useFakeTimers();

    // Reset all mocks
    vi.resetAllMocks();

    // Setup common mocks
    vi.mocked(os.tmpdir).mockReturnValue(mockTempDir);
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
    vi.mocked(net.createConnection).mockReturnValue(mockSocket as unknown as net.Socket);

    // Mock console methods
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize with socket path from info file if it exists', () => {
      // Setup
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockSocketInfo));

      // Execute
      new ElectronIpcClient();

      // Verify
      expect(fs.existsSync).toHaveBeenCalledWith(mockSocketInfoPath);
      expect(fs.readFileSync).toHaveBeenCalledWith(mockSocketInfoPath, 'utf8');
    });

    it('should initialize with default socket path if info file does not exist', () => {
      // Setup
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Execute
      new ElectronIpcClient();

      // Verify
      expect(fs.existsSync).toHaveBeenCalledWith(mockSocketInfoPath);
      expect(fs.readFileSync).not.toHaveBeenCalled();

      // Test platform-specific behavior
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      new ElectronIpcClient();
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should handle initialization errors gracefully', () => {
      // Setup - Mock the error
      vi.mocked(fs.existsSync).mockImplementation(() => {
        throw new Error('Mock file system error');
      });

      // Execute
      new ElectronIpcClient();

      // Verify
      expect(console.error).toHaveBeenCalledWith(
        'Failed to initialize IPC client:',
        expect.objectContaining({ message: 'Mock file system error' }),
      );
    });
  });

  describe('connection and request handling', () => {
    let client: ElectronIpcClient;

    beforeEach(() => {
      // Setup a client with a known socket path
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockSocketInfo));
      client = new ElectronIpcClient();

      // Reset socket mocks for each test
      mockSocket.on.mockReset();
      mockSocket.write.mockReset();

      // Default implementation for socket.on
      mockSocket.on.mockImplementation((event, callback) => {
        return mockSocket;
      });

      // Default implementation for socket.write
      mockSocket.write.mockImplementation((data, callback) => {
        if (callback) callback();
        return true;
      });
    });

    it('should handle connection errors', async () => {
      // Start request - but don't await it yet
      const requestPromise = client.sendRequest(ElectronIPCMethods.GET_DATABASE_PATH);

      // Find the error event handler
      const errorCallArgs = mockSocket.on.mock.calls.find((call) => call[0] === 'error');
      if (errorCallArgs && typeof errorCallArgs[1] === 'function') {
        const errorHandler = errorCallArgs[1];

        // Trigger the error handler
        errorHandler(new Error('Connection error'));
      }

      // Now await the promise
      await expect(requestPromise).rejects.toThrow('Connection error');
    });

    it('should handle write errors', async () => {
      // Setup connection callback
      let connectionCallback: Function | undefined;
      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      // Setup write to fail
      mockSocket.write.mockImplementation((data, callback) => {
        if (callback) callback(new Error('Write error'));
        return true;
      });

      // Start request
      const requestPromise = client.sendRequest(ElectronIPCMethods.GET_DATABASE_PATH);

      // Simulate connection established
      if (connectionCallback) connectionCallback();

      // Now await the promise
      await expect(requestPromise).rejects.toThrow('Write error');
    });
  });

  describe('API methods', () => {
    let client: ElectronIpcClient;

    beforeEach(() => {
      // Setup a client with a known socket path
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockSocketInfo));
      client = new ElectronIpcClient();

      // Mock sendRequest method
      vi.spyOn(client, 'sendRequest').mockImplementation((method, params) => {
        if (method === ElectronIPCMethods.GET_DATABASE_PATH) {
          return Promise.resolve('/path/to/database');
        } else if (method === ElectronIPCMethods.GET_USER_DATA_PATH) {
          return Promise.resolve('/path/to/user/data');
        }
        return Promise.reject(new Error('Unknown method'));
      });
    });

    it('should get database path correctly', async () => {
      const result = await client.getDatabasePath();
      expect(result).toBe('/path/to/database');
      expect(client.sendRequest).toHaveBeenCalledWith(ElectronIPCMethods.GET_DATABASE_PATH);
    });

    it('should get user data path correctly', async () => {
      const result = await client.getUserDataPath();
      expect(result).toBe('/path/to/user/data');
      expect(client.sendRequest).toHaveBeenCalledWith(ElectronIPCMethods.GET_USER_DATA_PATH);
    });
  });

  describe('close method', () => {
    let client: ElectronIpcClient;

    beforeEach(() => {
      // Setup a client with a known socket path
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockSocketInfo));
      client = new ElectronIpcClient();

      // Setup socket.on
      mockSocket.on.mockImplementation((event, callback) => {
        return mockSocket;
      });
    });

    it('should close the socket connection', async () => {
      // Setup connection callback
      let connectionCallback: Function | undefined;
      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      // Start a request to establish connection (but don't wait for it)
      const requestPromise = client
        .sendRequest(ElectronIPCMethods.GET_DATABASE_PATH)
        .catch(() => {}); // Ignore any errors

      // Simulate connection
      if (connectionCallback) connectionCallback();

      // Close the connection
      client.close();

      // Verify
      expect(mockSocket.end).toHaveBeenCalled();
    });

    it('should handle close when not connected', () => {
      // Close without connecting
      client.close();

      // Verify no errors
      expect(mockSocket.end).not.toHaveBeenCalled();
    });
  });
});
