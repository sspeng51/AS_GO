# 公共知识库批量导入

`batch-import.js` 将本地文件批量上传到智谱知识库。它使用 Node.js 内置
`fetch/FormData`，不需要安装额外依赖，要求 Node.js 18 或更高版本。

支持 `pdf/doc/docx/ppt/pptx/txt/md/xls/xlsx/csv`，默认单文件上限 100MB。
接口与参数遵循智谱知识库“上传文件文档”API。

## 配置

设置以下环境变量：

```dotenv
ZHIPU_API_KEY=你的智谱APIKey
ZHIPU_KNOWLEDGE_ID=目标知识库ID
```

工具默认读取 `web-admin/server/.env`，也可通过 `--env-file` 指定其他文件。
API Key 不会写入报告或控制台。

## 使用

先检查即将处理的文件，不调用 API：

```powershell
node tools/batch-import.js --data-dir DATA --dry-run
```

正式导入：

```powershell
node tools/batch-import.js --data-dir DATA
```

常用选项：

```text
--concurrency <1-10>       并发上传数，默认 3
--max-files <数量>         本次最多处理 100 个文件
--max-file-size-mb <大小>  单文件上限，最大 100MB
--retry-count <0-5>        429、5xx 和网络错误重试次数
--knowledge-type <类型>    固定切片类型
--sentence-size <20-2000>  自定义切片大小，仅类型 5 生效
--parse-image              解析文档内图片
--force                    强制重新上传已成功文件
--dry-run                  只扫描校验
```

不指定切片类型时，CSV/Excel 使用类型 3（按行），其他文件使用类型 1
（按标题段落）。

## 去重与失败处理

成功结果记录在数据目录的 `.batch-import-state.json`。再次执行时，相同内容的
文件会按 SHA-256 跳过；使用 `--force` 可重新上传。

工具逐文件检查智谱返回的 `successInfos/failedInfos`。任何文件失败都会输出
明确原因并返回非零退出码，成功文件不会因单个失败而重复上传。
