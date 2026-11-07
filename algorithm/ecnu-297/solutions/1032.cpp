#include <algorithm>
#include <functional>
#include <iostream>
#include <queue>
#include <utility>
#include <vector>

using namespace std;

struct Edge {
    int to;
    int cost;
};

const long long INF = 1LL << 60;

vector<long long> shortestPaths(const vector<vector<Edge>>& graph, int start) {
    using State = pair<long long, int>;
    priority_queue<State, vector<State>, greater<State>> pending;
    vector<long long> distance(graph.size(), INF);
    distance[start] = 0;
    pending.push({0, start});
    while (!pending.empty()) {
        auto [d, u] = pending.top();
        pending.pop();
        if (d != distance[u]) continue;
        for (const Edge& edge : graph[u]) {
            long long next = d + edge.cost;
            if (next >= distance[edge.to]) continue;
            distance[edge.to] = next;
            pending.push({next, edge.to});
        }
    }
    return distance;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int task, n, m, portals, start, target;
    if (!(cin >> task >> n >> m >> portals >> start >> target)) return 0;
    vector<vector<Edge>> graph(n + 1), reversed(n + 1);
    for (int i = 0; i < m; ++i) {
        int u, v, cost;
        cin >> u >> v >> cost;
        graph[u].push_back({v, cost});
        reversed[v].push_back({u, cost});
    }

    vector<long long> fromStart = shortestPaths(graph, start);
    // 在反图从终点出发，得到原图中各点到终点的距离。
    vector<long long> toTarget = shortestPaths(reversed, target);
    long long answer = fromStart[target];
    for (int i = 0; i < portals; ++i) {
        int u, v;
        cin >> u >> v;
        if (fromStart[u] != INF && toTarget[v] != INF) {
            answer = min(answer, fromStart[u] + toTarget[v]);
        }
    }
    if (answer == INF) cout << "inf\n";
    else cout << answer << '\n';
}
