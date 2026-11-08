// 参考《算法题讲义》第 5 章（第 193-196、201-204、217-218 页）。
#include <iostream>

constexpr int MaxVertices = 100;

// 0 <= n <= MaxVertices，顶点编号为 0 到 n - 1。
struct MGraph {
    int n = 0;
    int edge[MaxVertices][MaxVertices] = {};  // 无权图中，0 无边，1 有边。
};

struct ArcNode {
    int to;
    ArcNode *next = nullptr;
};

struct VNode {
    int data = 0;
    ArcNode *first = nullptr;
};

// 有向边 u -> v 只存一次。无向边在两端各存一条。
struct ALGraph {
    int n = 0;
    VNode vertices[MaxVertices] = {};
};

void visitVertex(int v) {
    std::cout << v << ' ';
}

void scanMatrixEdges(const MGraph &g) {
    for (int u = 0; u < g.n; ++u) {
        for (int v = 0; v < g.n; ++v) {
            if (g.edge[u][v] != 0) std::cout << u << " -> " << v << '\n';
        }
    }
}

void dfs(const ALGraph &g, int u, bool visited[]) {
    visited[u] = true;
    visitVertex(u);
    for (const ArcNode *p = g.vertices[u].first; p != nullptr; p = p->next) {
        if (!visited[p->to]) dfs(g, p->to, visited);
    }
}

void traverseDFS(const ALGraph &g) {
    bool visited[MaxVertices] = {};
    for (int u = 0; u < g.n; ++u) {
        if (!visited[u]) dfs(g, u, visited);
    }
}

void bfs(const ALGraph &g, int start, bool visited[]) {
    int queue[MaxVertices];
    int front = 0, rear = 0;
    visited[start] = true;
    queue[rear++] = start;
    while (front < rear) {
        int u = queue[front++];
        visitVertex(u);
        for (const ArcNode *p = g.vertices[u].first; p != nullptr; p = p->next) {
            int v = p->to;
            if (visited[v]) continue;
            // 入队时标记，避免同一顶点重复入队。
            visited[v] = true;
            queue[rear++] = v;
        }
    }
}

void traverseBFS(const ALGraph &g) {
    bool visited[MaxVertices] = {};
    for (int u = 0; u < g.n; ++u) {
        if (!visited[u]) bfs(g, u, visited);
    }
}

// order 至少有 n 个元素。仅返回 true 时才得到完整的拓扑序列。
bool topologicalSort(const ALGraph &g, int order[]) {
    int indegree[MaxVertices] = {};
    for (int u = 0; u < g.n; ++u) {
        for (const ArcNode *p = g.vertices[u].first; p != nullptr; p = p->next) {
            ++indegree[p->to];
        }
    }
    int front = 0, rear = 0;
    for (int u = 0; u < g.n; ++u) {
        if (indegree[u] == 0) order[rear++] = u;
    }
    // order 同时充当队列，按入队顺序得到拓扑序列。
    while (front < rear) {
        int u = order[front++];
        for (const ArcNode *p = g.vertices[u].first; p != nullptr; p = p->next) {
            if (--indegree[p->to] == 0) order[rear++] = p->to;
        }
    }
    return rear == g.n;  // 顶点没有全部入队，说明存在环。
}
