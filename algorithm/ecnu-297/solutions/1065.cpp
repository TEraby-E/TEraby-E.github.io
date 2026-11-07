#include <iostream>
using namespace std;

int main() {
    unsigned long long one[41] = {}, two[41] = {};
    for (int n = 1; n <= 40; ++n) {
        // 移动最大盘前，先把 n-1 个小盘移到不参与本次移动的柱子。
        one[n] = 2 * two[n - 1] + 1;
        two[n] = 2 * two[n - 1] + one[n - 1] + 2;
    }
    int n;
    while (cin >> n) cout << one[n] << '\n';
    return 0;
}
