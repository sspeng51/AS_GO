import openpyxl,pathlib,json,collections,statistics
p=pathlib.Path('D:/桌面/成果/论文/实验/五组对比试验/新图谱新数据库/五指标');out=pathlib.Path('outputs/five_groups_500');out.mkdir(parents=True,exist_ok=True)
sheets={};groups=collections.defaultdict(list);ids=set();questions=set()
for name in ['1-100','101-200','201-300','301-400','401-500']:
 w=openpyxl.load_workbook(p/(name+'.xlsx'),read_only=True,data_only=True)
 for s in w:
  rows=list(s.values);head=list(rows[0]);dest=sheets.setdefault(s.title,{'name':s.title,'headers':head+['来源文件'],'rows':[]});assert dest['headers']==head+['来源文件']
  for row in rows[1:]:dest['rows'].append(list(row)+[name+'.xlsx'])
  if s.title=='逐题指标':
   for r in rows[1:]:
    ids.add(r[0]);questions.add(r[2]);groups[(r[1],r[4],r[5],r[6],r[3],r[7])].append(r[8])
 w.close()
summary=[]
for key,vals in sorted(groups.items()):
 nums=[x for x in vals if isinstance(x,(int,float))];valid=[x for x in nums if x!=0];summary.append(list(key)+[statistics.mean(valid) if valid else None,len(valid),sum(x==0 for x in nums),len(vals)-len(nums),len(vals)])
result=[{'name':'整体汇总','headers':['知识库','生成模型','评审模型','评分版本','实验组','指标','均值（排除0与空白）','纳入数量','排除0值','空白或非数值','总记录数'],'rows':summary}]+list(sheets.values())
(out/'data.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
print('Experiments',len(ids),'Distinct question texts',len(questions));print([(s['name'],len(s['rows']),len(s['headers'])) for s in result])
