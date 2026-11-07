#include <algorithm>
#include <iostream>
#include <vector>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    if (!(cin >> n)) return 0;
    vector<int> prefixMax;
    prefixMax.reserve(n);
    while (n--) {
        int op;
        cin >> op;
        if (op == 1) {
            int x;
            cin >> x;
            // 栈中每一层存到这一层为止的最大值。
            prefixMax.push_back(prefixMax.empty() ? x : max(x, prefixMax.back()));
        } else if (op == 2) {
            prefixMax.pop_back();
        } else {
            cout << prefixMax.back() << '\n';
        }
    }
}
