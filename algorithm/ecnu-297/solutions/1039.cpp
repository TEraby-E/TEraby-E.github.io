#include <iostream>
#include <vector>

using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n;
    if (!(cin >> n)) return 0;
    vector<vector<int>> children(n);
    for (int i = 0; i < n; ++i) {
        int parent;
        cin >> parent;
        if (parent >= 0) children[parent].push_back(i);
    }

    vector<int> stack{0}, order;
    order.reserve(n);
    while (!stack.empty()) {
        int u = stack.back();
        stack.pop_back();
        order.push_back(u);
        for (int child : children[u]) stack.push_back(child);
    }

    // 出栈次序为根、右、左，逆序输出就是从左到右的后序遍历。
    for (int i = n - 1; i >= 0; --i) {
        if (i != n - 1) cout << ' ';
        cout << order[i];
    }
    cout << '\n';
}
