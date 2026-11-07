#include <iostream>
using namespace std;

int main() {
    int n;
    while (cin >> n) {
        // 最大的两个盘保持原顺序，需用辅助柱错开三次移动。
        // 其余盘组成的小塔可搬四次，每次按同尺寸盘不区分的方案搬；
        // 四次搬完，相同尺寸的盘恢复原顺序。
        unsigned long long smaller = (1ULL << n) - 2;
        cout << 4 * smaller + 3 << '\n';
    }
    return 0;
}
