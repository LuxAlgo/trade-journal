"""Exercise feature APIs against an explicitly selected disposable journal.
Run the app with JOURNAL_DATA_DIR pointing to a scratch directory first.
Example: python3 scripts/verify-features.py --base-url http://127.0.0.1:3002
This script creates fixtures; ports 3000 and 3001 are reserved for the working and original journals.
"""
import argparse, json, urllib.request, urllib.error, urllib.parse, uuid, base64
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', required=True, help='URL of a disposable journal with a separate JOURNAL_DATA_DIR')
BASE=parser.parse_args().base_url.rstrip('/')
target=urllib.parse.urlparse(BASE)
if target.scheme!='http' or target.hostname!='127.0.0.1' or not target.port or target.port in (3000,3001) or target.path or target.query or target.fragment or target.username or target.password:
    parser.error('Choose a disposable loopback server on a port other than 3000 or 3001.')
checks=[]
def call(path, body=None, method=None, status=200):
    request=urllib.request.Request(BASE+path, data=None if body is None else json.dumps(body).encode(), method=method or ('POST' if body is not None else 'GET'), headers={'Content-Type':'application/json'})
    try: response=urllib.request.urlopen(request)
    except urllib.error.HTTPError as e: response=e
    raw=response.read(); assert response.status==status,(path,response.status,raw[:500])
    return json.loads(raw) if raw else None

def passed(name): checks.append(name)
uid=uuid.uuid4().hex[:8]
a=call('/api/accounts',{'name':'Validation USD '+uid,'kind':'manual','currency':'USD'})['id']
b=call('/api/accounts',{'name':'Validation EUR '+uid,'kind':'manual','currency':'EUR'})['id']
book=call('/api/playbooks',{'name':'Opening range '+uid,'rules':['Entry confirmed','Risk accepted']})['id']
call('/api/settings',{'timeZone':'America/New_York','multipliers':{'ES':50}},'PATCH')
call('/api/settings',{'timeZone':'Not/AZone'},'PATCH',400)
call('/api/settings',{'multipliers':{'ES':-1}},'PATCH',400)
config={'breakeven':5,'breakevenMode':'money','feeRules':[{'id':'f','accountId':a,'symbol':'ES','amount':1,'mode':'unit'}],'riskRules':[{'id':'r','accountId':a,'symbol':'ES','stop':2,'target':4,'mode':'price'}]}
call('/api/workspace/defaults',config)
fills=[{'symbol':'ES','side':'buy','quantity':2,'price':5000,'fee':0,'executedAt':'2026-09-01T14:30:00Z','assetClass':'futures'},{'symbol':'ES','side':'sell','quantity':2,'price':5010,'fee':0,'executedAt':'2026-09-01T15:30:00Z','assetClass':'futures'}]
call('/api/executions',{'accountId':a,'executions':fills})
rows=call('/api/trades?accounts='+a)['trades'];t=rows[0];key=urllib.parse.quote(t['key'],safe='');path='/api/trades/'+key
assert t['fees']==4 and t['netPnl']==996 and t['stopLoss']==4998 and t['profitTarget']==5004,t
passed('Scoped default fees and direction-aware stops/targets')
call(path,{'notes':'## Setup review\n\n**Strong entry** with café notes.\n- [x] Plan followed','stopLoss':4995,'profitTarget':5015,'playbookId':book,'tags':['A+','trend'],'rating':4,'reviewed':True},'PATCH')
call('/api/executions',{'accountId':a,'executions':fills})
new=call(path)['trade'];assert new['notes'].startswith('## Setup') and new['stopLoss']==4995 and new['fees']==4
assert len(call('/api/trades?accounts='+a)['trades'])==1
assert abs(new['realizedR']-1.992)<1e-9 and new['plannedR']==3
passed('Reimport deduplication, annotation preservation, multiplier-aware R')
call('/api/executions',{'accountId':a,'executions':[{'symbol':'AAPL','side':'sell','quantity':1,'price':100,'fee':0,'executedAt':'2026-09-02T14:30:00Z','assetClass':'equity'},{'symbol':'AAPL','side':'buy','quantity':1,'price':105,'fee':0,'executedAt':'2026-09-02T15:30:00Z','assetClass':'equity'}]})
result=call('/api/trades?accounts='+a); assert result['metrics']['closedTrades']==2 and result['metrics']['netPnl']==991 and result['metrics']['breakevens']==1
passed('Breakeven tolerance changes classification without changing P&L')
query=urllib.parse.urlencode({'accounts':a,'symbol':'ES','tag':'A+,trend','reviewed':'yes','ratingMin':'4','rMin':'1.9','plannedRMin':'3','weekdays':'2','entryAfter':'10:00','entryBefore':'11:00','quantityMin':'2','durationMin':'60'})
assert len(call('/api/trades?'+query)['trades'])==1
assert call('/api/stats?'+query)['metrics']['closedTrades']==1
assert len(call('/api/journal?'+query)['days'])==1
assert len(call('/api/journal/2026-09-01?'+query)['trades'])==1
cross=call('/api/analysis?'+query+'&primary=playbook&secondary=weekday')
assert cross['groups'][0]['row']==book and cross['groups'][0]['column']=='Tue' and cross['summary']['netPnl']==996
assert call('/api/analysis?accounts='+a+'&direction=short')['summary']['netPnl']==-5
passed('Matching advanced filters on trades, dashboard, journal, cross-analysis and comparisons')
call(path+'/rules',{'rule':'Entry confirmed','followed':True});call(path+'/rules',{'rule':'Risk accepted','followed':False})
report=next(x for x in call('/api/adherence?accounts='+a)['books'] if x['id']==book)
assert report['rate']==.5 and report['broken']['trades']==1 and report['unassessed']==0
call(path+'/rules',{'rule':'Risk accepted','followed':True})
report=next(x for x in call('/api/adherence?accounts='+a)['books'] if x['id']==book)
assert report['rate']==1 and report['followed']['netPnl']==996
call(path+'/rules',{'rule':'Imaginary rule','followed':True},status=400)
passed('Rule check persistence, coverage and followed/broken performance')
progress=call('/api/workspace/progress');today=progress['today']
r=call('/api/workspace/progress',{'title':'Read plan '+uid,'stage':'Before trading','weekdays':list(range(7))})['id']
call('/api/workspace/progress',{'ruleId':r,'date':today,'done':True})
assert any(x['ruleId']==r and x['done'] for x in call('/api/workspace/progress')['checks'])
call('/api/workspace/progress',{'ruleId':r,'date':'2099-01-01','done':True},status=400)
passed('Routine check persistence and future-date validation')
note=call('/api/notes',{'title':'Review '+uid,'content':'## Week review\n\nReady','folderId':'my-notes'})['id']
call('/api/journal/2026-09-01',{'note':'## Daily plan\n\n- [x] Prepared'},'PUT')
template=call('/api/workspace/templates',{'name':'Review '+uid,'content':'## My template'})['id']
assert any(x['id']==template for x in call('/api/workspace/templates')['templates'])
passed('Formatted notes and reusable templates persisted')
# multipart upload, then byte-for-byte download and MIME verification
png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/sioAAAAASUVORK5CYII=')
def upload(content,name='chart.png',expected=200):
    boundary='journal-'+uid
    parts=[]
    for field,value in [('type','trade'),('id',t['key'])]: parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"\r\n\r\n{value}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: image/png\r\n\r\n'.encode()+content+b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    request=urllib.request.Request(BASE+'/api/attachments',b''.join(parts),headers={'Content-Type':'multipart/form-data; boundary='+boundary},method='POST')
    try: response=urllib.request.urlopen(request)
    except urllib.error.HTTPError as e:response=e
    raw=response.read();assert response.status==expected,(response.status,raw)
    return json.loads(raw)
attachment=upload(png)['id']
response=urllib.request.urlopen(BASE+'/api/attachments/'+attachment);assert response.read()==png and response.headers['Content-Type']=='image/png'
upload(b'<svg onload="alert(1)"></svg>',expected=400)
passed('Attachment round-trip, MIME and unsafe-format rejection')
prior=call('/api/stats?accounts='+a)['metrics']
missed=call('/api/workspace/missed',{'symbol':'NVDA','direction':'long','observedAt':'2026-09-02T15:00:00Z','entry':100,'stop':98,'target':106,'notes':'Missed entry '+uid,'playbookId':book})['id']
assert call('/api/stats?accounts='+a)['metrics']==prior
call('/api/workspace/missed',{'id':missed},'DELETE');call('/api/workspace/missed',{'id':missed,'restore':True},'DELETE')
assert next(x for x in call('/api/workspace/missed')['trades'] if x['id']==missed)['archivedAt'] is None
passed('Missed trades stay outside actual metrics and support archive/restore')
call('/api/executions',{'accountId':b,'executions':[{'symbol':'SPY','side':'buy','quantity':1,'price':100,'fee':0,'executedAt':'2026-09-01T14:30:00Z'},{'symbol':'SPY','side':'sell','quantity':1,'price':110,'fee':0,'executedAt':'2026-09-01T15:30:00Z'}]})
assert set(call('/api/analysis?accounts='+a+','+b)['currencies'])=={'USD','EUR'}
call('/api/settings',{'multipliers':{'ES':25}},'PATCH')
new=call(path)['trade'];assert new['grossPnl']==500 and new['stopLoss']==4995 and new['notes'].startswith('## Setup') and abs(new['realizedR']-1.984)<1e-9
call('/api/settings',{'multipliers':{'ES':50}},'PATCH')
passed('Currency identification and coherent recalculation when multipliers change')
print(json.dumps({'passed':len(checks),'checks':checks,'fixtures':{'account':a,'secondAccount':b,'tradeKey':t['key'],'book':book,'note':note,'routine':r,'today':today}},indent=2))
