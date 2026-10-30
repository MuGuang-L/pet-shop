const {spawnSync}=require('node:child_process');
const out=spawnSync(process.execPath,['--test','tests/mongo-integration.test.js','tests/mongo-scale.test.js','tests/payment-database.test.js'],{stdio:'inherit',env:{...process.env,PET_MONGO_TEST:'1'}});process.exitCode=out.status??1;
