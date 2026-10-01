const { WindowsBrowserWindowHelper } = require('./server/dist/services/browser/browserSession.js');
console.log('inspectWindow(undefined, ""):', WindowsBrowserWindowHelper.inspectWindow(undefined, ''));
console.log('inspectWindow(undefined, "Chrome"):', WindowsBrowserWindowHelper.inspectWindow(undefined, 'Chrome'));
