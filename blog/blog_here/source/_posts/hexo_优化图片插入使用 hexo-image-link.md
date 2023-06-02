---
title: hexo_优化图片插入使用 hexo-image-link
tag: 问题积累
---
之前使用的 assert-image package在hexo 6中使用出现问题，所以适应 hexo-image-link 来替代



介绍一下使用中的hexo插入图片的方法。
[cocowool/hexo-image-link: 当MD中引用本地文件时，处理生成的html中的图片链接。 (github.com)](https://github.com/cocowool/hexo-image-link)

## [](https://wangxiaoyu-go.github.io/2018/11/18/hexo-asset-image/#%E5%AE%89%E8%A3%85%E6%8F%92%E4%BB%B6 "安装插件")安装插件

npm 安装  

``` shell
$ npm install hexo-image-link --save
```


## [](https://wangxiaoyu-go.github.io/2018/11/18/hexo-asset-image/#%E7%BC%96%E8%BE%91%E9%85%8D%E7%BD%AE%E6%96%87%E4%BB%B6 "编辑配置文件")编辑配置文件

在hexo的`_config.yml`文件中，做以下修改  

<table><tbody><tr><td><pre><span>1</span><br></pre></td><td><pre><span>post_asset_folder: true</span><br></pre></td></tr></tbody></table>

做了这个修改的效果是，  
新建文章post时，会自动生成和文章名相同的文件夹。  
这个文件夹存放当前文章所用图片的地方。

以 `$ hexo new "shenghuo"` 为例，结构如下：

<table><tbody><tr><td><pre><span>1</span><br><span>2</span><br><span>3</span><br><span>4</span><br><span>5</span><br></pre></td><td><pre><span>shenghuo</span><br><span>├── picture1.jpg</span><br><span>├── picture2.jpg</span><br><span>└── picture3.jpg</span><br><span>shenghuo.md</span><br></pre></td></tr></tbody></table>

## [](https://wangxiaoyu-go.github.io/2018/11/18/hexo-asset-image/#%E5%9B%BE%E7%89%87%E6%8F%92%E5%85%A5%E6%97%B6%E7%9A%84%E8%AF%AD%E6%B3%95 "图片插入时的语法")图片插入时的语法

按照markdown的插入图片的语法来写，  
图片名称就是图片路径。  
e.g.  
`！[picture1](shenghuo/picture1.jpg)`

⚠️图片格式大写可能会找不到图片

