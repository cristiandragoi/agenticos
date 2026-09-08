const fs = require('fs');
const file = 'server/src/services/agent/agentLoop.ts';
let src = fs.readFileSync(file, 'utf8');
const before = `          } else if (tc.function.name === 'read_file' || tc.function.name === 'write_file' || tc.function.name === 'patch_file') {
            if (typeof args.path === 'string' && !path.isAbsolute(args.path)) {
              args.path = path.resolve(ws, args.path);
            }
`;
const after = `          } else if (tc.function.name === 'read_file' || tc.function.name === 'write_file' || tc.function.name === 'patch_file') {
            if (typeof args.path === 'string') {
              const alreadyAbsolute = path.isAbsolute(args.path) || path.win32.isAbsolute(args.path);
              if (!alreadyAbsolute) {
                args.path = path.win32.isAbsolute(ws)
                  ? path.win32.resolve(ws, args.path)
                  : path.resolve(ws, args.path);
              }
            }
`;
const count = src.split(before).length - 1;
if (count !== 1) throw new Error(`workspace path grounding: expected exactly one match, found ${count}`);
src = src.replace(before, after);
fs.writeFileSync(file, src, 'utf8');
console.log('patched cross-platform workspace path grounding');
