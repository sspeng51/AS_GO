import openpyxl,json,math
from pathlib import Path
p=Path('outputs/merged500');d=json.loads((p/'data.json').read_text(encoding='utf-8'));w=openpyxl.load_workbook(p/'Merged_500.xlsx',data_only=True)
assert w.sheetnames==['Summary','Per Question','Per Evidence']
assert w.worksheets[1].max_row==7001 and w.worksheets[2].max_row==9281
errors=[(s.title,c.coordinate,c.value) for s in w for row in s for c in row if c.data_type=='e'];assert not errors,errors
for si,key,cols in [(1,'questions',[0,1,2,4,6,8,11,12,13,14]),(2,'evidence',list(range(16)))]:
 for actual,expected in zip(w.worksheets[si].iter_rows(min_row=2,values_only=True),d[key]):
  for c in cols:
   a,b=actual[c],expected[c]
   if a is None and b == '':continue
   if isinstance(b,str) and b.startswith('=') and a=="'"+b:continue
   assert a==b or (isinstance(a,(float,int)) and isinstance(b,(float,int)) and math.isclose(a,b,rel_tol=1e-12)),(si,c,str(a)[:100],str(b)[:100])
print('Verified: 3 sheets; 500 question entries; 7000 metric rows; 9280 evidence rows; source values preserved; no Excel errors.')

