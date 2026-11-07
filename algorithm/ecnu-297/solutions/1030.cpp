#include <algorithm>
#include <iostream>
#include <numeric>
#include <vector>

using namespace std;

int findRoot(vector<int>& parent, int x) {
    if (parent[x] != x) parent[x] = findRoot(parent, parent[x]);
    return parent[x];
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n, m;
    if (!(cin >> n >> m)) return 0;
    vector<int> id(n + 1), parent(n + m + 1);
    vector<int> count(n + m + 1, 1), weight(n + m + 1, 1);
    iota(id.begin(), id.end(), 0);
    iota(parent.begin(), parent.end(), 0);
    int last = n;
    for (int i = 0; i < m; ++i) {
        int operation, x;
        cin >> operation >> x;
        int a = findRoot(parent, id[x]);
        if (operation == 1 || operation == 2) {
            int y;
            cin >> y;
            int b = findRoot(parent, id[y]);
            if (operation == 2) cout << (a == b) << '\n';
            else if (a != b) {
                if (weight[a] < weight[b]) swap(a, b);
                parent[b] = a;
                count[a] += count[b];
                weight[a] += weight[b];
            }
        } else if (operation == 3) {
            cout << count[a] << '\n';
        } else if (count[a] > 1) {
            // 旧节点仍可充当并查集的内部节点，实际元素改用新的编号。
            --count[a];
            id[x] = ++last;
        }
    }
}
