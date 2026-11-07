#include <algorithm>
#include <iostream>
using namespace std;

int tower[101][101];

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int cases;
    if (!(cin >> cases)) return 0;
    while (cases--) {
        int n;
        cin >> n;
        for (int i = 1; i <= n; ++i)
            for (int j = 1; j <= i; ++j) cin >> tower[i][j];

        // 从底向上，每个位置只依赖下一层的两个相邻位置。
        for (int i = n - 1; i >= 1; --i)
            for (int j = 1; j <= i; ++j)
                tower[i][j] += min(tower[i + 1][j], tower[i + 1][j + 1]);
        cout << tower[1][1] << '\n';
    }
    return 0;
}
