#include <iostream>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    const int denomination[] = {100, 50, 20, 10, 5, 2, 1};
    int cases;
    if (!(cin >> cases)) return 0;
    while (cases--) {
        int amount;
        cin >> amount;
        // 这组面额可以从大到小找零，任意面额组不一定适用。
        for (int i = 0; i < 7; ++i) {
            if (i) cout << ' ';
            cout << amount / denomination[i];
            amount %= denomination[i];
        }
        cout << '\n';
    }
    return 0;
}
