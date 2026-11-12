import openpyxl,pathlib,json,collections
p=pathlib.Path('C:/Users/29729/Desktop/成果/论文/实验/预处理实验/新500题/k=10')
names=['1-50.xlsx','51-150.xlsx','151-250.xlsx','250-350.xlsx','351-450.xlsx','451-500.xlsx']
out=pathlib.Path('outputs/merged500');out.mkdir(parents=True,exist_ok=True)
mapping={'评估完成':'Evaluation completed','上下文相关性':'Context relevance','证据效用':'Evidence utility','分（0–100）':'Score (0–100)','模型候选池估算':'Model estimate from candidate pool','模型估算':'Model estimate','需完整标准或生成候选池标准':'Complete reference criteria or generated candidate-pool criteria required','未开始':'Not started','检索失败':'Retrieval failed','初评失败':'Initial evaluation failed'}
def tr(v): return mapping.get(v,v) if isinstance(v,str) else v
qs=[];es=[];summ=[];qid={};rid={}
for name in names:
 w=openpyxl.load_workbook(p/name,data_only=True)
 summ.extend(list(w.worksheets[0].values)[1:])
 for row in list(w.worksheets[1].values)[1:]:
  row=list(row);q=(name,row[2])
  if q not in qid:qid[q]=len(qid)+1
  rid[row[0]]=(qid[q],row[1])
  qs.append([qid[q]]+[tr(v) for v in row]+[name])
 for row in list(w.worksheets[2].values)[1:]:
  es.append([rid[row[0]][0],rid[row[0]][1]]+list(row)+[name])
qs.sort(key=lambda r:(r[0],r[2]));es.sort(key=lambda r:(r[0],r[1],r[5]))
assert len(qid)==500,(len(qid))
assert len(rid)==1000,len(rid)
assert len(set((r[1],r[7]) for r in qs))==len(qs)
print('Questions',len(qid),'Records',len(rid),'Metric rows',len(qs),'Evidence rows',len(es))
print('Statuses',collections.Counter(r[5] for r in qs))
print('Summary',summ)
data={'questions':qs,'evidence':es,'summary':summ}
(out/'data.json').write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')

