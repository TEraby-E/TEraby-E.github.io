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

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int task, n, m, portals, start, target;
    if (!(cin >> task >> n >> m >> portals >> start >> target)) return 0;
    vector<vector<Edge>> graph(n + 1);
    for (int i = 0; i < m; ++i) {
        int u, v, cost;
        cin >> u >> v >> cost;
        graph[u].push_back({v, cost});
    }
    for (int i = 0; i < portals; ++i) {
        int u, v;
        cin >> u >> v;
        graph[u].push_back({v, 0});
    }

    const long long INF = 1LL << 60;
    vector<long long> distance(n + 1, INF);
    using State = pair<long long, int>;
    priority_queue<State, vector<State>, greater<State>> pending;
    distance[start] = 0;
    pending.push({0, start});
    while (!pending.empty()) {
        auto [d, u] = pending.top();
        pending.pop();
        if (d != distance[u]) continue;
        if (u == target) break;
        for (const Edge& edge : graph[u]) {
            long long next = d + edge.cost;
            if (next >= distance[edge.to]) continue;
            distance[edge.to] = next;
            pending.push({next, edge.to});
        }
    }
    if (distance[target] == INF) cout << "inf\n";
    else cout << distance[target] << '\n';
}
