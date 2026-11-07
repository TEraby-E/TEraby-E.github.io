#include <algorithm>
#include <iostream>
#include <utility>
#include <vector>

using namespace std;

pair<int, int> orderedPair(int a, int b) {
    if (a > b) swap(a, b);
    return {a, b};
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n, m, k;
    if (!(cin >> n >> m >> k)) return 0;
    vector<int> first(n), second(m);
    for (int& x : first) cin >> x;
    for (int& x : second) cin >> x;

    vector<pair<int, int>> same(k);
    for (auto& entry : same) {
        int x, y;
        cin >> x >> y;
        entry = orderedPair(x, y);
    }
    sort(same.begin(), same.end());

    bool duplicate = (n == m);
    for (int i = 0; duplicate && i < n; ++i) {
        if (first[i] == second[i]) continue;
        // 同义关系不传递，只检查这一对是否直接出现过。
        duplicate = binary_search(same.begin(), same.end(), orderedPair(first[i], second[i]));
    }
    cout << (duplicate ? "Yes" : "No") << '\n';
}
