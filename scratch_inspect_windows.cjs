const { WindowsBrowserWindowHelper } = require('./server/dist/services/browser/browserSession.js');
console.log('Inspect Chrome:', WindowsBrowserWindowHelper.inspectWindow(undefined, 'Chrome'));
console.log('Inspect Edge:', WindowsBrowserWindowHelper.inspectWindow(undefined, 'Edge'));
console.log('Inspect AgenticOS:', WindowsBrowserWindowHelper.inspectWindow(undefined, 'AgenticOS'));
