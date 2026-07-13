---
name: midware-mcp-integration
description: 通过 midware-mcp-client 插件获取用户接口文档和会话Token，并调用业务API获取数据。用于回答用户关于业务数据的问题。
license: MIT
---

# Midware MCP 集成使用指南

## 概述

本插件提供两个工具，用于连接 Midware 后端业务系统：

1. **get_user_docs_and_session** - 获取用户可调用的接口文档列表和临时会话Token
2. **call_business_api** - 根据会话Token调用具体的业务接口

## 工作流程

### 第一步：会话初始化

当用户发起对话时，需要先调用 `get_user_docs_and_session` 获取接口文档和会话Token。

**调用示例：**
```
工具: get_user_docs_and_session
参数: { user_token: "用户提供的临时Token" }
```

**返回数据：**
```json
{
  "api_docs": [
    {
      "name": "query_order_list",
      "description": "查询订单列表",
      "method": "GET",
      "path": "/api/v1/orders",
      "parameters": { ... },
      "response": { ... }
    }
  ],
  "session_token": "sess_xxx",
  "expires_in": 1200
}
```

### 第二步：理解用户意图，选择接口

仔细阅读 `api_docs` 中的每个接口文档：
- **name**: 接口名称
- **description**: 接口功能描述
- **method**: HTTP方法（GET/POST/PUT/DELETE）
- **path**: 接口路径
- **parameters**: 接口参数定义
- **response**: 返回数据结构

根据用户的问题，判断需要调用哪些接口。

### 第三步：调用业务接口

使用 `call_business_api` 调用选定的接口。

**调用示例：**
```
工具: call_business_api
参数: {
  session_token: "上一步获取的session_token",
  api_path: "/api/v1/orders",
  method: "GET",
  params: { "status": "pending", "page": 1 }
}
```

### 第四步：整合结果

将业务接口返回的JSON数据转换为用户友好的自然语言回答。

## 注意事项

- `session_token` 有效期约20分钟，过期后会收到 `session_token_expired` 错误，需重新调用 `get_user_docs_and_session`
- `user_token` 由前端获取，有效期较短，每个用户会话只需调用一次 `get_user_docs_and_session`
- 接口文档根据用户权限动态返回，不同用户看到的接口可能不同
- 如果调用业务接口返回 `permission_denied`，说明该用户无权限访问此接口
