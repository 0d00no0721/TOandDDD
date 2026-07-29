// ==UserScript==
// @name         Tanki Map Simplifier — 碰撞简化地图替换
// @namespace    https://github.com/0d00no0721/TOandDDD
// @version      1.0.0
// @description  劫持 map.bin 加载，用预构建的碰撞简化版替换原始地图（无需下载贴图）
// @match        *://*.3dtank.com/play*
// @match        *://*.tankionline.com/play*
// @match        *://*.test-eu.tankionline.com/browser-public/index.html*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
  'use strict';

  const LIBRARY_KEY = 'Tanki_Simplified_Maps_Library';
  const ENABLED_KEY = 'Tanki_Simplified_Maps_Enabled';
  const VER_KEY = 'Tanki_Simplified_Maps_LibVer';

  function isEnabled() {
    try { return localStorage.getItem(ENABLED_KEY) !== 'false'; } catch(e) { return true; }
  }

  function getLibrary() {
    try { return JSON.parse(localStorage.getItem(LIBRARY_KEY) || 'null'); } catch(e) { return null; }
  }

  function findSimplifiedMap(url) {
    const lib = getLibrary();
    if (!lib || !lib.maps) return null;
    for (const mapName in lib.maps) {
      const entry = lib.maps[mapName];
      if (entry.themes) {
        for (const themePath in entry.themes) {
          if (url.includes(themePath)) {
            return { mapName, themeName: entry.themes[themePath], base64: entry.simplifiedBase64 };
          }
        }
      }
    }
    return null;
  }

  function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'map-simplifier-status';
    overlay.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99999;background:rgba(0,20,40,0.9);color:#76ff33;border:1px solid rgba(118,255,51,0.3);border-radius:8px;padding:8px 12px;font-size:12px;font-family:monospace;backdrop-filter:blur(6px);max-width:300px;pointer-events:auto;cursor:pointer;';
    overlay.innerHTML = '<div id="ms-title" style="font-weight:bold;margin-bottom:4px;">🗺️ 地图简化器</div><div id="ms-status" style="color:#8a9ba8;">状态: 检查中...</div><div id="ms-hint" style="color:#556;font-size:10px;margin-top:4px;">点击切换开/关</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', () => {
      const enabled = isEnabled();
      localStorage.setItem(ENABLED_KEY, String(!enabled));
      updateStatus();
    });
    return overlay;
  }

  function updateStatus() {
    const statusEl = document.getElementById('ms-status');
    const titleEl = document.getElementById('ms-title');
    if (!statusEl || !titleEl) return;
    const enabled = isEnabled();
    const lib = getLibrary();
    const mapCount = lib && lib.maps ? Object.keys(lib.maps).length : 0;
    if (!lib) {
      titleEl.style.color = '#ff6644';
      statusEl.textContent = '状态: 未安装地图库';
      statusEl.style.color = '#ff6644';
    } else if (!enabled) {
      titleEl.style.color = '#8a9ba8';
      statusEl.textContent = '状态: 已关闭 (库: ' + mapCount + ' 张)';
      statusEl.style.color = '#8a9ba8';
    } else {
      titleEl.style.color = '#76ff33';
      statusEl.textContent = '状态: 已启用 (库: ' + mapCount + ' 张)';
      statusEl.style.color = '#76ff33';
    }
  }

  let lastReplacedUrl = null;
  let lastMapName = null;

  function log(msg) { console.log('[MapSimplifier] ' + msg); }

  const blobCache = {};

  function getSimplifiedBlobUrl(originalUrl, match) {
    if (blobCache[originalUrl]) return blobCache[originalUrl];
    try {
      const bytes = base64ToUint8Array(match.base64);
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const blobUrl = URL.createObjectURL(blob);
      blobCache[originalUrl] = blobUrl;
      lastReplacedUrl = originalUrl;
      lastMapName = match.mapName;
      log('替换地图: ' + match.mapName + ' (' + match.themeName + ') → ' + (bytes.length / 1024).toFixed(1) + ' KB');
      const statusEl = document.getElementById('ms-status');
      if (statusEl) {
        statusEl.textContent = '替换: ' + match.mapName + ' (' + (bytes.length / 1024).toFixed(0) + 'KB)';
        statusEl.style.color = '#ffaa00';
      }
      return blobUrl;
    } catch(e) {
      log('替换失败: ' + e.message);
      return null;
    }
  }

  // === fetch 劫持 ===
  const originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = (input instanceof Request) ? input.url : String(input);
    if (url.endsWith('map.bin') && isEnabled()) {
      const match = findSimplifiedMap(url);
      if (match) {
        log('拦截 fetch: ' + url);
        const blobUrl = getSimplifiedBlobUrl(url, match);
        if (blobUrl) {
          return originalFetch.call(this, blobUrl, init);
        }
      } else {
        log('未匹配到简化地图: ' + url);
      }
    }
    return originalFetch.call(this, input, init);
  };

  // === XMLHttpRequest 劫持 ===
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this._msUrl = String(url);
    this._msMethod = method;
    this._msArgs = args;
    this._msMatch = null;
    if (this._msUrl.endsWith('map.bin') && isEnabled()) {
      this._msMatch = findSimplifiedMap(this._msUrl);
    }
    if (!this._msMatch) return originalOpen.call(this, method, url, ...args);
  };

  XMLHttpRequest.prototype.send = function(body) {
    if (this._msMatch && isEnabled()) {
      log('拦截 XHR: ' + this._msUrl);
      const blobUrl = getSimplifiedBlobUrl(this._msUrl, this._msMatch);
      if (blobUrl) {
        originalOpen.call(this, this._msMethod, blobUrl, ...this._msArgs);
      }
    }
    return originalSend.call(this, body);
  };

  // === UI ===
  function initUI() {
    if (document.getElementById('map-simplifier-status')) return;
    createOverlay();
    updateStatus();
    log('已启动。地图库: ' + (getLibrary() ? Object.keys(getLibrary().maps).length + ' 张' : '未安装'));
    log('如需安装/更新地图库，运行 build-library.js 并将 out/library/library.json 内容粘贴到 localStorage["' + LIBRARY_KEY + '"]');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }

  // === 地图库安装接口 ===
  // 用户可通过浏览器控制台执行 TankiMapSimplifier.installLibrary(jsonString) 安装地图库
  window.TankiMapSimplifier = {
    installLibrary: function(jsonStr) {
      try {
        const lib = JSON.parse(jsonStr);
        if (!lib.maps) throw new Error('Invalid library format');
        localStorage.setItem(LIBRARY_KEY, jsonStr);
        localStorage.setItem(VER_KEY, String(lib.version || 1));
        log('地图库已安装: ' + Object.keys(lib.maps).length + ' 张地图');
        updateStatus();
        return true;
      } catch(e) {
        console.error('[MapSimplifier] 安装失败:', e.message);
        return false;
      }
    },
    enable: function() { localStorage.setItem(ENABLED_KEY, 'true'); updateStatus(); },
    disable: function() { localStorage.setItem(ENABLED_KEY, 'false'); updateStatus(); },
    status: function() {
      const lib = getLibrary();
      return {
        enabled: isEnabled(),
        mapsInstalled: lib && lib.maps ? Object.keys(lib.maps).length : 0,
        lastReplaced: lastMapName
      };
    }
  };

  log('脚本已加载 (v1.0.0)');
})();
