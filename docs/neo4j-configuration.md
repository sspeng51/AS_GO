# Neo4j 连接配置

当前 Aura 实例：`8785b1b2`（Free instance）。管理入口：https://console.neo4j.io

```dotenv
NEO4J_URI=neo4j+s://8785b1b2.databases.neo4j.io
NEO4J_USERNAME=8785b1b2
NEO4J_PASSWORD=<由私有环境变量注入>
NEO4J_DATABASE=8785b1b2
AURA_INSTANCEID=8785b1b2
AURA_INSTANCENAME=Free instance
```

URI 在 dotenv 中使用 `neo4j+s://`，不要保留导出文件中的反斜杠。

小程序图谱、前端混合问答、后台检索、答案对比与评估共用 `processKnowledge` 云函数的 Neo4j 配置。`handlers/hybridRag.js` 通过 `handlers/neo4jGraph.js` 执行只读查询；前端不持有数据库凭据。文档检索仍使用原有智谱知识库，混合检索的图谱证据使用上述 Neo4j 实例。

私有配置保存于 `cloudfunctions/.env.local` 与 `web-admin/server/.env`，已由 Git 忽略。云函数不会自动加载这些本地文件：运行 `node tools/neo4j-cloud-config.cjs --apply` 同步六项连接配置，保留云端其他环境变量；运行 `node tools/neo4j-cloud-config.cjs` 核对是否一致。该工具需要后台配置中的 CloudBase 凭据。

切换后重新发起检索与评估；历史结果是原运行的快照，不会自动转换为新库结果。此操作不迁移旧图谱数据。Aura 两项变量仅用于实例标识，实际连接使用四项 `NEO4J_*`。

## 公共文档知识库

当前默认智谱知识库为 `2100852235595599872`，小程序文档问答、混合检索、后台检索与评估均使用此默认库。后台各评估页面的新建任务预填该 ID；显式选择的其他库及历史记录保留原始归属。使用 `node tools/neo4j-cloud-config.cjs --knowledge --apply` 同步云函数的 `ZHIPU_KNOWLEDGE_ID`，不修改 Neo4j 配置。
