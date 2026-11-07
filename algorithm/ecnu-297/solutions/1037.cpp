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

    int students, relations, queries;
    if (!(cin >> students >> relations >> queries)) return 0;
    int capacity = max(students, relations);
    vector<int> parent(capacity + 1), size(capacity + 1, 1);
    iota(parent.begin(), parent.end(), 0);

    for (int i = 0; i < relations; ++i) {
        int a, b;
        cin >> a >> b;
        a = findRoot(parent, a);
        b = findRoot(parent, b);
        if (a == b) continue;
        if (size[a] < size[b]) swap(a, b);
        parent[b] = a;
        size[a] += size[b];
    }
    for (int i = 0; i < queries; ++i) {
        int a, b;
        cin >> a >> b;
        cout << (findRoot(parent, a) == findRoot(parent, b)) << '\n';
    }
}
