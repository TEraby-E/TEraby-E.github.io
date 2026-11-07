#include <algorithm>
#include <iostream>
#include <numeric>
#include <vector>

using namespace std;

int findRoot(vector<int>& parent, int x) {
    if (parent[x] != x) parent[x] = findRoot(parent, parent[x]);
    return parent[x];
}

void unite(vector<int>& parent, vector<int>& size, int x, int y) {
    x = findRoot(parent, x);
    y = findRoot(parent, y);
    if (x == y) return;
    if (size[x] < size[y]) swap(x, y);
    parent[y] = x;
    size[x] += size[y];
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int cases;
    if (!(cin >> cases)) return 0;
    while (cases--) {
        int n, m;
        cin >> n >> m;
        vector<int> parent(2 * n + 1), size(2 * n + 1, 1);
        iota(parent.begin(), parent.end(), 0);
        for (int i = 0; i < m; ++i) {
            char operation;
            int x, y;
            cin >> operation >> x >> y;
            if (operation == 'A') {
                // x + n 表示与 x 敌对的一方。
                unite(parent, size, x, y + n);
                unite(parent, size, x + n, y);
            } else if (findRoot(parent, x) == findRoot(parent, y)) {
                cout << "In the same gang.\n";
            } else if (findRoot(parent, x) == findRoot(parent, y + n)) {
                cout << "In different gangs.\n";
            } else {
                cout << "Not sure yet.\n";
            }
        }
    }
}
