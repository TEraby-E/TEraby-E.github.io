#include <algorithm>
#include <iostream>
#include <limits>
#include <numeric>
#include <vector>

using namespace std;

struct Edge {
    int u;
    int v;
    int weight;
};

int findRoot(vector<int>& parent, int x) {
    if (parent[x] != x) parent[x] = findRoot(parent, parent[x]);
    return parent[x];
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n, m;
    if (!(cin >> n >> m)) return 0;
    vector<Edge> edges(m);
    for (Edge& edge : edges) cin >> edge.u >> edge.v >> edge.weight;
    int start, target;
    cin >> start >> target;
    if (start == target) {
        cout << 0 << '\n';
        return 0;
    }

    sort(edges.begin(), edges.end(), [](const Edge& a, const Edge& b) {
        return a.weight < b.weight;
    });
    const int INF = numeric_limits<int>::max();
    int answer = INF;
    vector<int> parent(n + 1), size(n + 1);

    // 固定允许使用的最小边权，逐步提高最大边权，直到两点连通。
    for (int left = 0; left < m && answer != 0; ++left) {
        if (left > 0 && edges[left].weight == edges[left - 1].weight) continue;
        iota(parent.begin(), parent.end(), 0);
        fill(size.begin(), size.end(), 1);
        for (int right = left; right < m; ++right) {
            int difference = edges[right].weight - edges[left].weight;
            if (difference >= answer) break;
            int a = findRoot(parent, edges[right].u);
            int b = findRoot(parent, edges[right].v);
            if (a == b) continue;
            if (size[a] < size[b]) swap(a, b);
            parent[b] = a;
            size[a] += size[b];
            if (findRoot(parent, start) == findRoot(parent, target)) {
                answer = difference;
                break;
            }
        }
    }
    cout << (answer == INF ? -1 : answer) << '\n';
}
