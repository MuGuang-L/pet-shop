// Compatibility launcher. The insecure role-switching HTTP server has been retired.
const {createServer}=require('../server/http');if(require.main===module)require('../server/index').start().catch(e=>{console.error(e.message);process.exitCode=1;});module.exports={createServer};
