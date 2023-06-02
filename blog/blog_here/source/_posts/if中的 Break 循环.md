---
title: 两个while循环，if中的 Break 循环 如何回到最外层
tags:
 - AI 辅助学习

---

**Q:**
~~~ python
while(True):
    inp = input('Choose the mode: ')
    if inp == '1':
        break
    elif inp == 'SI':
        while(True):
            command = input('Input command: ')
            ser.write(str.encode(command))
            line = ser.readline()
            print(line)
            if command == '1':
                break
        inp = '0'
~~~
seems like I can't back to the top while loop again when I input 1 in SI~~~

**A:**
ChatGPT 修改


~~~python
while True:
    inp = input('Choose the mode: ')
    if inp == '1':
        break
    elif inp == 'SI':
        while True:
            command = input('Input command: ')
            ser.write(str.encode(command))
            line = ser.readline().decode().rstrip()
            print(line)
            if command == 'out':
                break  # exit the SI mode loop and go back to the top-level loop
        inp = ''  # reset inp to empty string for next iteration


~~~
This version adds an extra `break` statement to exit the SI mode loop and go back to the top-level loop when the `command` input is 'out'. It also sets `inp` to an empty string after the `break`, so that the `Choose the mode:` prompt appears again for the next iteration.

Note that the `decode()` and `rstrip()` methods are used to convert the bytes returned by `readline()` to a string and remove any trailing white space characters, respectively. This can help with parsing the serial input.

Comment:
有错误在身上的，应该让break 来到 ser.write前面，不然其实所有的命令都会被 ser.write()吞掉：所以应该改成
```python
while(True):
    inp = input('Choose the mode: ')
    if inp == '1':
        break
    elif inp == 'SI':
        while(True):
            command = input('Input command: ')
             if command == '1':
                break
            ser.write(str.encode(command))
            line = ser.readline()
            print(line)
           
        inp = '0'
```