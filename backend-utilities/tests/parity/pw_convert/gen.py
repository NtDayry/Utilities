import json, random, sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[3]))
from app.purified_water.mqtt_ingest import convert, read_field
random.seed(int(sys.argv[1]) if len(sys.argv)>1 else 7)
cases=[]
types=["analog_4_20ma","bcd_hex","float32_cdab"]
raws=[]
for _ in range(20000):
    k=random.random()
    if k<0.35: raw=random.randint(-100,25000)
    elif k<0.5: raw=round(random.uniform(-10,30000),random.randint(0,6))
    elif k<0.6: raw=str(random.choice([random.randint(0,20000), round(random.uniform(0,500),3)]))
    elif k<0.8: raw=[random.randint(0,0xFFFF), random.randint(0,0xFFFF)]
    elif k<0.85: raw=[random.randint(0,0x9999)]
    elif k<0.9: raw=random.choice(["abc","", " 12 ", "0x10", "1e3", True, None, "nan", [1,2,3], [70000, 1], -0.0, 4000.5])
    else: raw=[random.choice([0x0012,0x0099,0x0100,0x1234]), random.choice([0x3400,0x0001,0x9999,0x5000])]
    cfg={"decode_type":random.choice(types),"raw_min":random.choice([0,0,4000]),"raw_max":random.choice([20000,20000,16000,0]),
         "range_min":random.choice([0,-50,10]),"range_max":random.choice([100,2000,14,10]),"decimal_places":random.choice([0,1,2,3,None])}
    c=convert(raw,cfg)
    cases.append({"raw":raw,"cfg":cfg,"out":None if c is None else {"raw":c.raw,"value":c.value,"status":c.status}})
paths=[({"a":{"b":5}},"a.b"),({"regs":[1,2]},"regs.1"),({"value":3},""),({"a":[{"x":1}]},"a.0.x"),({"a":1},"a.b"),({"r":[1]},"r.5"),({"a":None},"a")]
json.dump({"cases":cases,"paths":[{"p":p,"path":k,"out":read_field(p,k)} for p,k in paths]},open("cases.json","w"))
print(len(cases))
