#include <algorithm>
#include <iostream>

using namespace std;

const int MAX_N = 12;
const long long INF = 1LL << 60;
long long weight[MAX_N][MAX_N];
long long dp[1 << MAX_N][MAX_N];

int main() {
    int n, m;
    if (!(cin >> n >> m)) return 0;
    for (int u = 0; u < n; ++u) {
        fill(weight[u], weight[u] + n, INF);
        weight[u][u] = 0;
    }

    for (int i = 0; i < m; ++i) {
        int u, v;
        long long cost;
        cin >> u >> v >> cost;
        --u;
        --v;
        if (u != v) weight[u][v] = min(weight[u][v], cost);
    }

    int full = (1 << n) - 1;
    for (int mask = 0; mask <= full; ++mask) fill(dp[mask], dp[mask] + n, INF);
    // 任意一条回路都可从城市 1 开始，固定起点即可。
    dp[1][0] = 0;
    for (int mask = 1; mask <= full; mask += 2) {
        for (int u = 0; u < n; ++u) {
            if (dp[mask][u] == INF) continue;
            for (int v = 1; v < n; ++v) {
                if ((mask & (1 << v)) || weight[u][v] == INF) continue;
                int next = mask | (1 << v);
                dp[next][v] = min(dp[next][v], dp[mask][u] + weight[u][v]);
            }
        }
    }

    long long answer = INF;
    for (int u = 0; u < n; ++u) {
        if (dp[full][u] != INF && weight[u][0] != INF) {
            answer = min(answer, dp[full][u] + weight[u][0]);
        }
    }
    cout << (answer == INF ? -1 : answer) << '\n';
}
