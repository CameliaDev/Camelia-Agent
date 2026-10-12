data=open(r"C:\Users\37963\AppData\Local\com.camelia.desktop\EBWebView\Default\Local Storage\leveldb\000003.log","rb").read()
print("len", len(data))
print("version count", data.count(b'"version"'))
print("userSet count", data.count(b"userSetRightRail"))
print("rightCollapsed true", data.count(b'"rightCollapsed":true'))
print("rightCollapsed false", data.count(b'"rightCollapsed":false'))
# last occurrence of rightCollapsed
i=data.rfind(b"rightCollapsed")
print("last rightCollapsed at", i)
print(data[i-80:i+200])
# any write with version near end
j=data.rfind(b'"version"')
print("last version at", j)
if j>=0: print(data[j-40:j+200])
