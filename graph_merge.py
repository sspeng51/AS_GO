import openpyxl,pathlib,json,collections,statistics
p=pathlib.Path('C:/Users/29729/Desktop/成果/论文/实验/图谱质量实验/新图谱');out=pathlib.Path('outputs/graph500');out.mkdir(parents=True,exist_ok=True)
qs=[];es=[]
for name in ['1-50','51-150','151-250','251-300','301-400','401-500']:
 w=openpyxl.load_workbook(p/(name+'.xlsx'),data_only=True);offset=int(name.split('-')[0])-1
 for row in list(w.worksheets[1].values)[1:]:
  r=list(row);r[0]+=offset;r[2]={'自动评估完成':'Evaluation completed','评估失败':'Evaluation failed','检索失败':'Retrieval failed'}.get(r[2],r[2]);qs.append(r+[name+'.xlsx'])
 for row in list(w.worksheets[2].values)[1:]:
  r=list(row);r[0]+=offset;es.append(r+[name+'.xlsx'])
assert [r[0] for r in qs]==list(range(1,501))
summary=[]
for i,m in enumerate(['Recall@9','Precision@9','MRR','NDCG@9','Hit Rate@9','Context relevance'],5):
 eligible=[r[i] for r in qs if r[2]=='Evaluation completed' and isinstance(r[i],(float,int))]
 nonzero=[x for x in eligible if x!=0]
 summary.append([m,statistics.mean(nonzero) if nonzero else None,len(nonzero),sum(x==0 for x in eligible),500-len(eligible)])
print(collections.Counter(r[2] for r in qs));print(summary);print('evidence',len(es))
(out/'data.json').write_text(json.dumps({'questions':qs,'evidence':es,'summary':summary},ensure_ascii=False),encoding='utf-8')
