#include <algorithm>
#include <iostream>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int cases;
    if (!(cin >> cases)) return 0;
    while (cases--) {
        int length, n;
        cin >> length >> n;
        int earliest = 0, latest = 0;
        for (int i = 0; i < n; ++i) {
            int x;
            cin >> x;
            // 相遇掉头等价于穿过彼此并交换身份，掉落时刻不变。
            earliest = max(earliest, min(x, length - x));
            latest = max(latest, max(x, length - x));
        }
        cout << earliest << ' ' << latest << '\n';
    }
    return 0;
}
