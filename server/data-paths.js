'use strict';
const path=require('node:path');
// A restored instance can use its own accounts and images without replacing the
// running shop's data. Default remains compatible with existing installations.
const dataDirectory=path.resolve(process.env.SHOP_DATA_DIR||path.join(__dirname,'../.local'));
if(require('node:fs').existsSync(path.join(dataDirectory,'RESTORE_INCOMPLETE')))throw Error('RESTORE_INCOMPLETE');
module.exports={dataDirectory};
